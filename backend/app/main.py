import asyncio
import logging

from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from .config import settings
from .db import engine
from .ws import manager
from .routers import workshops, guests, checkin, search, import_export, lark_sync, registration_forms, auth, admin_users, zbs
from .auth.bootstrap import bootstrap_super_admin
from .services import admin_directory_sync
from .db import async_session_maker

log = logging.getLogger("app.lifespan")
_directory_sync_task: asyncio.Task | None = None
_zbs_task: asyncio.Task | None = None


async def _directory_sync_loop():
    await asyncio.sleep(60)
    while True:
        try:
            async with async_session_maker() as db:
                await admin_directory_sync.sync_directory(db)
        except Exception as exc:
            log.warning("Lark directory sync failed: %s", exc)
        await asyncio.sleep(max(300, settings.LARK_DIRECTORY_SYNC_INTERVAL_SECONDS))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Wait for DB to be ready
    last_err: Exception | None = None
    for attempt in range(15):
        try:
            async with engine.begin() as conn:
                await conn.execute(text("SELECT 1"))
            last_err = None
            break
        except (OperationalError, OSError) as e:
            last_err = e
            wait = min(2.0, 0.5 * (attempt + 1))
            log.warning(
                "DB not ready (attempt %d/15): %s; retry in %.1fs",
                attempt + 1, e, wait,
            )
            await asyncio.sleep(wait)
    if last_err is not None:
        log.error("DB unreachable after retries: %s", last_err)
        raise last_err

    await bootstrap_super_admin()

    global _directory_sync_task
    if settings.LARK_DIRECTORY_SYNC_ENABLED:
        _directory_sync_task = asyncio.create_task(_directory_sync_loop())
    global _zbs_task
    if settings.ZBS_ENABLED:
        from .services import zbs
        _zbs_task = asyncio.create_task(zbs.worker_loop(async_session_maker))

    yield

    # Shutdown
    if _directory_sync_task:
        _directory_sync_task.cancel()
    if _zbs_task:
        _zbs_task.cancel()


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
app.include_router(lark_sync.router)
app.include_router(registration_forms.router)
app.include_router(auth.router)
app.include_router(admin_users.router)
app.include_router(zbs.router)

_upload_dir = Path(settings.UPLOAD_DIR)
_upload_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_upload_dir)), name="uploads")


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
            # echo + keep connection open for welcome broadcasts
            await ws.send_json({"type": "echo", "data": msg})
    except WebSocketDisconnect:
        await manager.disconnect(ws)
    except Exception:
        await manager.disconnect(ws)
