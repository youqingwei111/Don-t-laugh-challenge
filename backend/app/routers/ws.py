from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from app.websocket.manager import manager
from app.routers.room import rooms_db
from app.models import Player
from app.utils.game_utils import get_or_create_game, remove_game, GameTask
import json
import random
import asyncio

router = APIRouter()

# 任务间隔配置（秒）
TASK_INTERVAL_MIN = 30
TASK_INTERVAL_MAX = 60

# 触发禁忌词惩罚配置
MAX_VIOLATIONS = 3


@router.websocket("/ws/{room_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    room_id: str,
    player_id: str = Query(...),
    nickname: str = Query(...)
):
    print(f"[WS] New connection: room_id={room_id}, player_id={player_id}, nickname={nickname}")

    if room_id not in rooms_db:
        print(f"[WS] Room not found: {room_id}")
        await websocket.close(code=4004)
        return

    room = rooms_db[room_id]
    print(f"[WS] Room found. host_id={room.host_id}, players={[p.id for p in room.players]}")

    player = room.get_player(player_id)
    if not player:
        print(f"[WS] Player not found in room: player_id={player_id}")
        await websocket.close(code=4001)
        return

    await manager.connect(websocket, room_id, player_id, nickname)

    await manager.broadcast(room_id, {
        "type": "player_joined",
        "player_id": player_id,
        "nickname": nickname,
        "players": [p.model_dump() for p in room.players]
    })

    await manager.send_personal(websocket, {
        "type": "room_state",
        "room": room.model_dump()
    })

    try:
        while True:
            data = await websocket.receive_json()
            print(f"[WS RECEIVE] room={room_id}, player={player_id}, data={data}")
            await handle_message(websocket, room_id, player_id, data)
    except WebSocketDisconnect:
        print(f"[WS] Player disconnected: player_id={player_id}")
        manager.disconnect(websocket, room_id)
        room = rooms_db.get(room_id)
        if room:
            player = room.get_player(player_id)
            if player:
                player.is_ready = False
            await manager.broadcast(room_id, {
                "type": "player_left",
                "player_id": player_id,
                "nickname": nickname,
                "players": [p.model_dump() for p in room.players]
            })
    except Exception as e:
        print(f"[WS] Unexpected error: {e}")


async def handle_message(websocket: WebSocket, room_id: str, player_id: str, data: dict):
    print(f"[HANDLE] player_id={player_id}, data={data}")

    room = rooms_db.get(room_id)
    if not room:
        print("[HANDLE] Room not found")
        return

    msg_type = data.get("type")
    print(f"[HANDLE] msg_type='{msg_type}'")

    # -------------------- 心跳 --------------------
    if msg_type == "ping":
        print(f"[HANDLE] Pong sent to {player_id}")
        await manager.send_personal(websocket, {"type": "pong"})
        return

    # -------------------- 准备 --------------------
    if msg_type == "ready":
        player = room.get_player(player_id)
        if player:
            player.is_ready = data.get("ready", True)
            print(f"[HANDLE] Player {player_id} ready={player.is_ready}")
            await manager.broadcast(room_id, {
                "type": "player_ready",
                "player_id": player_id,
                "is_ready": player.is_ready,
                "players": [p.model_dump() for p in room.players]
            })
            await check_all_ready(room_id, room)

    # -------------------- 开始游戏 --------------------
    elif msg_type == "start_game":
        print(f"[HANDLE] start_game request from player_id={player_id}")
        print(f"[HANDLE] room.host_id={room.host_id}, comparing with player_id={player_id}")
        print(f"[HANDLE] Match: {room.host_id == player_id}")

        if room.host_id == player_id:
            print(f"[HANDLE] Host authorized, calling start_game()")
            await start_game(room_id, room)
        else:
            print(f"[HANDLE] Rejected: only host can start game")

    elif msg_type == "chat":
        await manager.broadcast(room_id, {
            "type": "chat",
            "player_id": player_id,
            "nickname": data.get("nickname", ""),
            "message": data.get("message", "")
        }, exclude=websocket)

    # -------------------- WebRTC 信令 --------------------
    elif msg_type == "offer":
        target_id = data.get("target_id")
        if target_id:
            await manager.send_to_player(room_id, target_id, {
                "type": "offer",
                "offer": data.get("offer"),
                "from_id": player_id,
                "from_nickname": data.get("from_nickname", "")
            })

    elif msg_type == "answer":
        target_id = data.get("target_id")
        if target_id:
            await manager.send_to_player(room_id, target_id, {
                "type": "answer",
                "answer": data.get("answer"),
                "from_id": player_id
            })

    elif msg_type == "ice-candidate":
        target_id = data.get("target_id")
        if target_id:
            await manager.send_to_player(room_id, target_id, {
                "type": "ice-candidate",
                "candidate": data.get("candidate"),
                "from_id": player_id
            })

    # -------------------- 游戏内消息 --------------------
    elif msg_type == "get_taboo_words":
        game = get_or_create_game(room_id, room.players)
        if player_id in game.state.taboo_words:
            await manager.send_personal(websocket, {
                "type": "taboo_words",
                "words": game.get_filtered_taboo_words(player_id),
                "my_word": game.state.taboo_words.get(player_id, "未分配")
            })

    elif msg_type == "report_violation":
        reported_player_id = data.get("reported_player_id")
        await process_violation(room_id, room, reported_player_id, player_id)

    elif msg_type == "request_rematch":
        if room.host_id == player_id:
            await reset_game(room_id, room)

    elif msg_type == "leave_game":
        await handle_leave_game(room_id, room, player_id)

    else:
        print(f"[HANDLE] Unknown msg_type: '{msg_type}' - ignored")


async def process_violation(room_id: str, room, reported_player_id: str, reporter_id: str):
    print(f"[VIOLATION] reported={reported_player_id}, reporter={reporter_id}")
    game = get_or_create_game(room_id, room.players)

    if reported_player_id not in game.state.violations:
        game.state.violations[reported_player_id] = 0

    game.state.violations[reported_player_id] += 1
    current_violations = game.state.violations[reported_player_id]

    reported_player = room.get_player(reported_player_id)
    reporter_player = room.get_player(reporter_id)

    is_eliminated = current_violations >= MAX_VIOLATIONS

    await manager.broadcast(room_id, {
        "type": "violation_punished",
        "reported_player_id": reported_player_id,
        "reported_player_name": reported_player.nickname if reported_player else "未知",
        "reporter_id": reporter_id,
        "reporter_name": reporter_player.nickname if reporter_player else "未知",
        "violation_count": current_violations,
        "max_violations": MAX_VIOLATIONS,
        "is_eliminated": is_eliminated,
        "message": f"{reported_player.nickname} 说了禁忌词！({'已淘汰' if is_eliminated else f'还剩{MAX_VIOLATIONS - current_violations}次机会'})" if reported_player else ""
    })

    if is_eliminated:
        await manager.broadcast(room_id, {
            "type": "player_eliminated",
            "player_id": reported_player_id,
            "player_name": reported_player.nickname,
            "violation_count": current_violations
        })


async def reset_game(room_id: str, room):
    print(f"[RESET] Resetting game for room {room_id}")
    game = get_or_create_game(room_id, room.players)

    for player in room.players:
        player.is_ready = False

    game.state.is_active = False
    game.state.taboo_words = {}
    game.state.violations = {}
    game.state.current_task = None
    game.state.round = 1

    room.status = "waiting"

    await manager.broadcast(room_id, {
        "type": "game_reset",
        "room": room.model_dump(),
        "message": "游戏已重置，等待玩家准备"
    })


async def handle_leave_game(room_id: str, room, player_id: str):
    game = get_or_create_game(room_id, room.players)

    if player_id in game.state.violations:
        game.state.violations[player_id] = MAX_VIOLATIONS

    player = room.get_player(player_id)
    if player:
        player.is_ready = False

    await manager.broadcast(room_id, {
        "type": "player_left",
        "player_id": player_id,
        "player_name": player.nickname if player else "未知",
        "players": [p.model_dump() for p in room.players]
    })


async def check_all_ready(room_id: str, room):
    print(f"[CHECK_READY] players in room: {len(room.players)}")
    if len(room.players) < 1:
        await manager.broadcast(room_id, {
            "type": "waiting_players",
            "message": f"等待更多玩家加入"
        })
        return

    all_ready = all(p.is_ready for p in room.players)
    print(f"[CHECK_READY] all_ready={all_ready}, player states={[p.is_ready for p in room.players]}")
    if all_ready:
        await manager.broadcast(room_id, {
            "type": "all_ready",
            "message": "所有玩家已准备，游戏即将开始..."
        })


async def start_game(room_id: str, room):
    print(f"[START_GAME] Starting game for room {room_id}")

    # 防重入锁：如果游戏已经在进行中，忽略重复请求
    if room.status == "playing":
        print(f"[START_GAME] Game already in progress, ignoring duplicate request")
        return

    room.status = "playing"
    print(f"[START_GAME] room.status set to 'playing'")

    game = get_or_create_game(room_id, room.players)
    game.state.is_active = True
    game.state.taboo_words = game.distribute_taboo_words()
    game.state.round = 1
    game.state.violations = {}

    print(f"[START_GAME] taboo_words distributed: {game.state.taboo_words}")

    # 广播开始游戏消息给所有人
    connections = manager.get_room_connections(room_id)
    print(f"[START_GAME] Broadcasting to {len(connections)} connections:")
    for conn in connections:
        print(f"  - player_id={conn['player_id']}, nickname={conn['nickname']}")

    await manager.broadcast(room_id, {
        "type": "game_start",
        "room": room.model_dump(),
        "round": game.state.round
    })
    print(f"[START_GAME] game_start broadcasted to {len(connections)} players")

    # 单独发送给每个玩家他们应该看到的禁忌词
    for conn in manager.get_room_connections(room_id):
        pid = conn["player_id"]
        await manager.send_personal(conn["websocket"], {
            "type": "taboo_words",
            "words": game.get_filtered_taboo_words(pid),
            "my_word": game.state.taboo_words.get(pid, "未分配")
        })
    print(f"[START_GAME] taboo_words sent to each player")

    # 启动任务定时器
    asyncio.create_task(game_loop(room_id))
    print(f"[START_GAME] game_loop task created")


async def game_loop(room_id: str):
    print(f"[GAME_LOOP] Started for room {room_id}")
    room = rooms_db.get(room_id)
    if not room:
        print(f"[GAME_LOOP] Room not found, exiting")
        return

    game = get_or_create_game(room_id, room.players)

    while game.state.is_active and room.status == "playing":
        wait_time = random.randint(TASK_INTERVAL_MIN, TASK_INTERVAL_MAX)
        print(f"[GAME_LOOP] Waiting {wait_time}s before next task")
        await asyncio.sleep(wait_time)

        if not game.state.is_active:
            break

        task = game.generate_task()
        print(f"[GAME_LOOP] Generated task: {task.description}")

        await manager.broadcast(room_id, {
            "type": "new_task",
            "task": {
                "id": task.id,
                "description": task.description,
                "target_player_id": task.target_player_id,
                "target_player_name": task.target_player_name,
                "round": game.state.round
            }
        })

        await asyncio.sleep(30)
        game.next_round()


async def end_game(room_id: str, room):
    game = get_or_create_game(room_id, room.players)
    game.end_game()

    room.status = "finished"
    await manager.broadcast(room_id, {
        "type": "game_end",
        "final_scores": {}
    })