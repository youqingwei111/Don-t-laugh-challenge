from fastapi import WebSocket
from typing import Dict, List


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

    def disconnect(self, websocket: WebSocket, room_id: str):
        if room_id in self.active_connections:
            self.active_connections[room_id] = [
                conn for conn in self.active_connections[room_id]
                if conn["websocket"] != websocket
            ]
            if not self.active_connections[room_id]:
                del self.active_connections[room_id]

    async def broadcast(self, room_id: str, message: dict, exclude: WebSocket = None):
        if room_id not in self.active_connections:
            return
        dead_connections = []
        for conn in self.active_connections[room_id]:
            if conn["websocket"] == exclude:
                continue
            try:
                await conn["websocket"].send_json(message)
            except Exception:
                dead_connections.append(conn)
        for conn in dead_connections:
            self.disconnect(conn["websocket"], room_id)

    async def send_personal(self, websocket: WebSocket, message: dict):
        try:
            await websocket.send_json(message)
        except Exception:
            pass

    def get_room_connections(self, room_id: str) -> List[dict]:
        return self.active_connections.get(room_id, [])

    def get_player_count(self, room_id: str) -> int:
        return len(self.active_connections.get(room_id, []))

    def get_player_ids(self, room_id: str) -> List[str]:
        """获取房间内所有玩家ID"""
        return [conn["player_id"] for conn in self.get_room_connections(room_id)]

    async def send_to_player(self, room_id: str, target_player_id: str, message: dict):
        """向房间内指定玩家发送消息"""
        if room_id not in self.active_connections:
            return
        for conn in self.active_connections[room_id]:
            if conn["player_id"] == target_player_id:
                try:
                    await conn["websocket"].send_json(message)
                except Exception:
                    pass
                break


manager = ConnectionManager()
