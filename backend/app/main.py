from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import room, ws

app = FastAPI(title="互动游戏 API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(room.router, prefix="/api/rooms", tags=["房间"])
app.include_router(ws.router, prefix="/api", tags=["WebSocket"])


@app.get("/api/health")
def health_check():
    return {"status": "ok"}