import asyncio
import logging

from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from .db import engine
from .ws import manager
from .routers import workshops, guests, checkin, search, import_export, lark_sync, registration_forms

log = logging.getLogger("app.lifespan")


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

    # Start Lark polling background task
    lark_sync.start_lark_poll()

    yield

    # Shutdown
    lark_sync.stop_lark_poll()


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
