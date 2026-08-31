import asyncio
import logging

from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from .config import settings
from .db import engine
from .ws import manager
from .routers import workshops, guests, checkin, search, import_export, registration_forms, auth, admin_users, zbs, zalo_agent, zalo_messages, admin_api_keys, public_api
from .auth.bootstrap import bootstrap_super_admin
from .services import admin_directory_sync
from .db import async_session_maker

log = logging.getLogger("app.lifespan")
_directory_sync_task: asyncio.Task | None = None
_zbs_task: asyncio.Task | None = None
_zalo_messages_task: asyncio.Task | None = None


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
    global _zalo_messages_task
    if settings.ZALO_MESSAGES_ENABLED:
        from .services import zalo_messages
        _zalo_messages_task = asyncio.create_task(zalo_messages.worker_loop(async_session_maker))

    yield

    # Shutdown
    if _directory_sync_task:
        _directory_sync_task.cancel()
    if _zbs_task:
        _zbs_task.cancel()
    if _zalo_messages_task:
        _zalo_messages_task.cancel()


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
app.include_router(registration_forms.router)
app.include_router(auth.router)
app.include_router(admin_users.router)
app.include_router(zbs.router)
app.include_router(zalo_agent.router)
app.include_router(zalo_messages.router)
app.include_router(admin_api_keys.router)
app.include_router(public_api.router)


@app.exception_handler(HTTPException)
async def public_http_exception(request: Request, exc: HTTPException):
    if not request.url.path.startswith("/api/public/v1"):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=exc.headers)
    codes = {
        400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND",
        409: "CONFLICT", 410: "GONE", 422: "VALIDATION_ERROR", 429: "RATE_LIMITED",
        503: "SERVICE_UNAVAILABLE",
    }
    return JSONResponse(
        status_code=exc.status_code,
        content={"data": None, "meta": None, "error": {
            "code": codes.get(exc.status_code, "HTTP_ERROR"),
            "message": str(exc.detail),
            "details": None,
        }},
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def public_validation_exception(request: Request, exc: RequestValidationError):
    if not request.url.path.startswith("/api/public/v1"):
        return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})
    return JSONResponse(status_code=422, content={
        "data": None, "meta": None,
        "error": {"code": "VALIDATION_ERROR", "message": "request validation failed", "details": jsonable_encoder(exc.errors())},
    })


def _public_openapi() -> dict:
    routes = [
        route for route in app.routes
        if getattr(route, "path", "").startswith("/api/public/v1")
        and getattr(route, "include_in_schema", False)
    ]
    return get_openapi(
        title="Workshop Check-in Public API",
        version="1.0.0",
        description="Versioned API for workshop, guest, registration, and check-in integrations.",
        routes=routes,
    )


@app.get("/api/public/v1/openapi.json", include_in_schema=False)
async def public_openapi():
    return _public_openapi()


@app.get("/api/public/v1/docs", include_in_schema=False)
async def public_docs():
    return get_swagger_ui_html(
        openapi_url="/api/public/v1/openapi.json",
        title="Workshop Check-in Public API",
    )


@app.get("/api/public/v1/redoc", include_in_schema=False)
async def public_redoc():
    return get_redoc_html(
        openapi_url="/api/public/v1/openapi.json",
        title="Workshop Check-in Public API",
    )

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
