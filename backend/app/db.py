import socket
import urllib.parse

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

from .config import settings


def _resolve_to_ip(hostname: str) -> str:
    """Resolve a hostname to its first IPv4 address.

    Workaround: the docker embedded DNS resolver (127.0.0.11) together
    with python:3.11-slim returns errno -6 ("ai_family not supported")
    when asyncpg / SQLAlchemy asks for AF_UNSPEC (-1). Resolving once
    via stdlib getaddrinfo here and substituting the IP lets asyncpg
    connect via the working AF_INET path (and incidentally avoids any
    residual DNS timing issue).
    """
    if not hostname:
        return hostname
    # Already an IP literal — return as-is.
    try:
        socket.inet_aton(hostname)
        return hostname
    except OSError:
        pass
    try:
        infos = socket.getaddrinfo(hostname, None, family=socket.AF_INET, type=socket.SOCK_STREAM)
        return infos[0][4][0]
    except OSError:
        return hostname  # fall back, let the engine surface the error


# Resolve once at import time before the engine is built.
_resolved_pg = _resolve_to_ip(settings.POSTGRES_HOST)
_resolved_redis = _resolve_to_ip(settings.REDIS_HOST)
if _resolved_pg != settings.POSTGRES_HOST:
    object.__setattr__(settings, "POSTGRES_HOST", _resolved_pg)
if _resolved_redis != settings.REDIS_HOST:
    object.__setattr__(settings, "REDIS_HOST", _resolved_redis)


def _build_database_url() -> str:
    """Build the postgres URL with safe percent-encoding of the password.

    The default password contains '@' (e.g. workshop@dieptra); when the
    password is interpolated into an `asyncpg://` URL a bare '@' is
    ambiguous to the URL parser, so percent-encode it. Same for any
    special chars (':' / '/' / '?' / '#' / '[' / ']' / '@').
    """
    user = urllib.parse.quote(settings.POSTGRES_USER, safe="")
    pwd = urllib.parse.quote(settings.POSTGRES_PASSWORD or "", safe="")
    host = settings.POSTGRES_HOST
    port = settings.POSTGRES_PORT
    db = urllib.parse.quote(settings.POSTGRES_DB or "", safe="")
    return f"postgresql+asyncpg://{user}:{pwd}@{host}:{port}/{db}"


engine = create_async_engine(_build_database_url(), echo=False, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session
