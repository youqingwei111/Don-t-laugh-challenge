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
MAX_VIOLATIONS = 3  # 超过3次惩罚则淘汰


@router.websocket("/ws/{room_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    room_id: str,
    player_id: str = Query(...),
    nickname: str = Query(...)
):
    if room_id not in rooms_db:
        await websocket.close(code=4004)
        return

    room = rooms_db[room_id]
    player = room.get_player(player_id)
    if not player:
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
            await handle_message(websocket, room_id, player_id, data)
    except WebSocketDisconnect:
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


async def handle_message(websocket: WebSocket, room_id: str, player_id: str, data: dict):
    room = rooms_db.get(room_id)
    if not room:
        return

    msg_type = data.get("type")

    if msg_type == "ready":
        player = room.get_player(player_id)
        if player:
            player.is_ready = data.get("ready", True)
            await manager.broadcast(room_id, {
                "type": "player_ready",
                "player_id": player_id,
                "is_ready": player.is_ready,
                "players": [p.model_dump() for p in room.players]
            })
            await check_all_ready(room_id, room)

    elif msg_type == "start_game":
        if room.host_id == player_id:
            await start_game(room_id, room)

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
        # 玩家举报某人说了禁忌词
        reported_player_id = data.get("reported_player_id")
        await process_violation(room_id, room, reported_player_id, player_id)

    elif msg_type == "request_rematch":
        # 房主请求再来一局
        if room.host_id == player_id:
            await reset_game(room_id, room)

    elif msg_type == "leave_game":
        # 玩家主动离开游戏
        await handle_leave_game(room_id, room, player_id)


async def process_violation(room_id: str, room, reported_player_id: str, reporter_id: str):
    """
    处理触发禁忌词事件
    1. 更新被举报玩家的惩罚计数
    2. 广播惩罚状态给所有人
    3. 如果达到最大惩罚次数，标记玩家淘汰
    """
    game = get_or_create_game(room_id, room.players)

    # 初始化惩罚计数
    if not hasattr(game.state, 'violations'):
        game.state.violations = {}

    if reported_player_id not in game.state.violations:
        game.state.violations[reported_player_id] = 0

    game.state.violations[reported_player_id] += 1
    current_violations = game.state.violations[reported_player_id]

    # 获取被惩罚玩家信息
    reported_player = room.get_player(reported_player_id)
    reporter_player = room.get_player(reporter_id)

    is_eliminated = current_violations >= MAX_VIOLATIONS
    is_punished = current_violations > 0

    # 广播惩罚状态
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

    # 如果玩家被淘汰，广播淘汰状态
    if is_eliminated:
        await manager.broadcast(room_id, {
            "type": "player_eliminated",
            "player_id": reported_player_id,
            "player_name": reported_player.nickname,
            "violation_count": current_violations
        })


async def reset_game(room_id: str, room):
    """
    重置游戏 - 再来一局
    1. 重置所有玩家的准备状态
    2. 重置游戏引擎状态
    3. 广播重置消息
    """
    game = get_or_create_game(room_id, room.players)

    # 重置玩家状态
    for player in room.players:
        player.is_ready = False

    # 重置游戏引擎
    game.state.is_active = False
    game.state.taboo_words = {}
    game.state.violations = {}
    game.state.current_task = None
    game.state.round = 1

    room.status = "waiting"

    # 广播重置消息
    await manager.broadcast(room_id, {
        "type": "game_reset",
        "room": room.model_dump(),
        "message": "游戏已重置，等待玩家准备"
    })


async def handle_leave_game(room_id: str, room, player_id: str):
    """处理玩家离开游戏"""
    game = get_or_create_game(room_id, room.players)

    # 如果是游戏中的玩家，标记其状态
    if player_id in getattr(game.state, 'violations', {}):
        game.state.violations[player_id] = MAX_VIOLATIONS  # 标记为淘汰

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
    if len(room.players) < 1:
        await manager.broadcast(room_id, {
            "type": "waiting_players",
            "message": f"等待更多玩家加入"
        })
        return

    all_ready = all(p.is_ready for p in room.players)
    if all_ready:
        await manager.broadcast(room_id, {
            "type": "all_ready",
            "message": "所有玩家已准备，游戏即将开始..."
        })


async def start_game(room_id: str, room):
    """开始游戏 - 分配禁忌词并启动任务定时器"""
    room.status = "playing"

    game = get_or_create_game(room_id, room.players)
    game.state.is_active = True
    game.state.taboo_words = game.distribute_taboo_words()
    game.state.round = 1
    game.state.violations = {}  # 重置惩罚计数

    await manager.broadcast(room_id, {
        "type": "game_start",
        "room": room.model_dump(),
        "round": game.state.round
    })

    # 单独发送给每个玩家他们应该看到的禁忌词
    for conn in manager.get_room_connections(room_id):
        player_id = conn["player_id"]
        await manager.send_personal(conn["websocket"], {
            "type": "taboo_words",
            "words": game.get_filtered_taboo_words(player_id),
            "my_word": game.state.taboo_words.get(player_id, "未分配")
        })

    # 启动任务定时器
    asyncio.create_task(game_loop(room_id))


async def game_loop(room_id: str):
    """游戏循环 - 定时派发任务"""
    room = rooms_db.get(room_id)
    if not room:
        return

    game = get_or_create_game(room_id, room.players)

    while game.state.is_active and room.status == "playing":
        wait_time = random.randint(TASK_INTERVAL_MIN, TASK_INTERVAL_MAX)
        await asyncio.sleep(wait_time)

        if not game.state.is_active:
            break

        task = game.generate_task()

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
    """结束游戏"""
    game = get_or_create_game(room_id, room.players)
    game.end_game()

    room.status = "finished"
    await manager.broadcast(room_id, {
        "type": "game_end",
        "final_scores": {}
    })