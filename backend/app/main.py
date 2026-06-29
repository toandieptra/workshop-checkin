from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .db import engine
from .ws import manager
from .routers import workshops, guests, checkin, search, import_export, upload_sessions, lark_sync


@asynccontextmanager
async def lifespan(app: FastAPI):
    # cho DB san sang (migration chay boi postgres initdb)
    async with engine.begin() as conn:
        await conn.execute(text("SELECT 1"))
    yield


app = FastAPI(title="workshop-checkin-backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(workshops.router)
app.include_router(guests.router)
app.include_router(checkin.router)
app.include_router(search.router)
app.include_router(import_export.router)
app.include_router(upload_sessions.router)
app.include_router(lark_sync.router)


@app.get("/api/health")
async def health():
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "db": db_ok}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            msg = await ws.receive_text()
            # echo (Phase 1) + giu ket noi cho broadcast welcome
            await ws.send_json({"type": "echo", "data": msg})
    except WebSocketDisconnect:
        await manager.disconnect(ws)
    except Exception:
        await manager.disconnect(ws)
