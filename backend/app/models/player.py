from enum import Enum
from pydantic import BaseModel, Field
from typing import Optional


class PlayerStatus(str, Enum):
    ACTIVE = "active"
    PUNISHED = "punished"
    ELIMINATED = "eliminated"


class Player(BaseModel):
    id: str = Field(..., description="玩家唯一ID")
    nickname: str = Field(..., min_length=1, max_length=20, description="昵称")
    is_ready: bool = Field(default=False, description="是否准备")
    taboo_word: Optional[str] = Field(default=None, description="分配的禁忌词")
    status: PlayerStatus = Field(default=PlayerStatus.ACTIVE, description="玩家状态")

    class Config:
        use_enum_values = True