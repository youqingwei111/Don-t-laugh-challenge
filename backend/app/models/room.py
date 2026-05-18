from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
from .player import Player


class Room(BaseModel):
    id: str = Field(..., description="房间唯一ID")
    name: str = Field(..., description="房间名称")
    players: List[Player] = Field(default_factory=list, description="玩家列表")
    max_players: int = Field(default=5, description="最大玩家数")
    host_id: str = Field(..., description="房主ID")
    status: str = Field(default="waiting", description="房间状态: waiting/playing/finished")
    created_at: datetime = Field(default_factory=datetime.now, description="创建时间")

    def add_player(self, player: Player) -> bool:
        if len(self.players) >= self.max_players:
            return False
        self.players.append(player)
        return True

    def remove_player(self, player_id: str) -> bool:
        for i, p in enumerate(self.players):
            if p.id == player_id:
                self.players.pop(i)
                return True
        return False

    def get_player(self, player_id: str) -> Optional[Player]:
        return next((p for p in self.players if p.id == player_id), None)