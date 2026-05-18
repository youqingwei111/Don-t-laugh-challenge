from fastapi import APIRouter, HTTPException
from app.models import Room, Player
from app.utils.game_utils import generate_room_id, generate_player_id

router = APIRouter()

rooms_db: dict[str, Room] = {}


@router.post("/", response_model=Room)
def create_room(name: str, host_id: str, host_nickname: str) -> Room:
    room_id = generate_room_id()
    host = Player(id=host_id, nickname=host_nickname)
    room = Room(id=room_id, name=name, host_id=host_id)
    room.add_player(host)
    rooms_db[room_id] = room
    return room


@router.get("/{room_id}", response_model=Room)
def get_room(room_id: str) -> Room:
    if room_id not in rooms_db:
        raise HTTPException(status_code=404, detail="房间不存在")
    return rooms_db[room_id]


@router.post("/{room_id}/join")
def join_room(room_id: str, player_id: str, nickname: str) -> Room:
    if room_id not in rooms_db:
        raise HTTPException(status_code=404, detail="房间不存在")
    room = rooms_db[room_id]
    if len(room.players) >= room.max_players:
        raise HTTPException(status_code=400, detail="房间已满")
    player = Player(id=player_id, nickname=nickname)
    if not room.add_player(player):
        raise HTTPException(status_code=400, detail="加入房间失败")
    return room