from fastapi import WebSocket
from fastapi.encoders import jsonable_encoder
from starlette.websockets import WebSocketDisconnect
from typing import Dict, List
import json


class ConnectionManager:
    def __init__(self):
        # room_id -> list of (websocket, player_id, nickname)
        self.active_connections: Dict[str, List[dict]] = {}

    async def connect(self, websocket: WebSocket, room_id: str, player_id: str, nickname: str):
        await websocket.accept()
        if room_id not in self.active_connections:
            self.active_connections[room_id] = []
        self.active_connections[room_id].append({
            "websocket": websocket,
            "player_id": player_id,
            "nickname": nickname
        })
        print(f"[MANAGER] connect() added player_id={player_id}, room_id={room_id}")
        print(f"[MANAGER] active_connections[{room_id}] now has {len(self.active_connections[room_id])} connections")

    def disconnect(self, websocket: WebSocket, room_id: str):
        print(f"[MANAGER] disconnect() called for room_id={room_id}")
        if room_id in self.active_connections:
            before = len(self.active_connections[room_id])
            self.active_connections[room_id] = [
                conn for conn in self.active_connections[room_id]
                if conn["websocket"] != websocket
            ]
            after = len(self.active_connections[room_id])
            print(f"[MANAGER] Removed connection, count: {before} -> {after}")
            if not self.active_connections[room_id]:
                del self.active_connections[room_id]
                print(f"[MANAGER] Room {room_id} now empty, removed from active_connections")

    async def broadcast(self, room_id: str, message: dict, exclude: WebSocket = None):
        print(f"[MANAGER] broadcast() called for room_id={room_id}, message_type={message.get('type')}")
        if room_id not in self.active_connections:
            print(f"[MANAGER] broadcast FAILED: room_id={room_id} not in active_connections!")
            print(f"[MANAGER] Available room_ids: {list(self.active_connections.keys())}")
            return

        # 使用 jsonable_encoder 安全编码数据，避免 datetime 等类型序列化失败
        safe_message = jsonable_encoder(message)
        print(f"[MANAGER] Message encoded successfully")

        print(f"[MANAGER] Broadcasting to {len(self.active_connections[room_id])} connections in room {room_id}")
        dead_connections = []
        for conn in self.active_connections[room_id]:
            if conn["websocket"] == exclude:
                print(f"[MANAGER] Skipping excluded connection for player_id={conn['player_id']}")
                continue
            try:
                await conn["websocket"].send_json(safe_message)
                print(f"[MANAGER] Successfully sent {message.get('type')} to player_id={conn['player_id']}")
            except WebSocketDisconnect as e:
                # 只有真正断开时才移除连接
                print(f"[MANAGER] WebSocket真正断开了 player_id={conn['player_id']}: {e}")
                dead_connections.append(conn)
            except TypeError as e:
                # 序列化错误不应该移除连接，只打印警告
                print(f"[MANAGER] TypeError序列化错误(已修复) player_id={conn['player_id']}: {e}")
            except Exception as e:
                # 其他异常打印日志但不移除连接
                print(f"[MANAGER] Unexpected error player_id={conn['player_id']}: {e}")

        for conn in dead_connections:
            print(f"[MANAGER] Marking dead connection for player_id={conn['player_id']} for removal")
            self.disconnect(conn["websocket"], room_id)

    async def send_personal(self, websocket: WebSocket, message: dict):
        # 使用 jsonable_encoder 安全编码数据
        safe_message = jsonable_encoder(message)
        try:
            await websocket.send_json(safe_message)
            print(f"[MANAGER] send_personal() SUCCESS: type={message.get('type')}")
        except WebSocketDisconnect as e:
            print(f"[MANAGER] send_personal() WebSocket断开了: {e}")
        except TypeError as e:
            print(f"[MANAGER] send_personal() TypeError序列化错误(已修复): {e}")
        except Exception as e:
            print(f"[MANAGER] send_personal() FAILED: {e}")

    def get_room_connections(self, room_id: str) -> List[dict]:
        result = self.active_connections.get(room_id, [])
        print(f"[MANAGER] get_room_connections({room_id}) -> {len(result)} connections")
        return result

    def get_player_count(self, room_id: str) -> int:
        return len(self.active_connections.get(room_id, []))

    def get_player_ids(self, room_id: str) -> List[str]:
        return [conn["player_id"] for conn in self.get_room_connections(room_id)]

    async def send_to_player(self, room_id: str, target_player_id: str, message: dict):
        print(f"[MANAGER] send_to_player() to {target_player_id} in room {room_id}")
        if room_id not in self.active_connections:
            print(f"[MANAGER] send_to_player FAILED: room not found")
            return
        for conn in self.active_connections[room_id]:
            if conn["player_id"] == target_player_id:
                # 使用 jsonable_encoder 安全编码
                safe_message = jsonable_encoder(message)
                try:
                    await conn["websocket"].send_json(safe_message)
                    print(f"[MANAGER] send_to_player SUCCESS to {target_player_id}")
                except WebSocketDisconnect as e:
                    print(f"[MANAGER] send_to_player() WebSocket断开了 {target_player_id}: {e}")
                except TypeError as e:
                    print(f"[MANAGER] send_to_player() TypeError序列化错误(已修复): {e}")
                except Exception as e:
                    print(f"[MANAGER] send_to_player FAILED to {target_player_id}: {e}")
                return
        print(f"[MANAGER] send_to_player FAILED: player {target_player_id} not found in room")


manager = ConnectionManager()