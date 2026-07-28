import asyncio

import httpx
import pytest
from fastapi import HTTPException

from app.config import settings
from app.services import zalo_agent
from app.services.zalo_agent import bridge_request


class FakeClient:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        pass

    async def request(self, *_args, **_kwargs):
        if self.error:
            raise self.error
        return self.response


@pytest.mark.anyio
async def test_bridge_requires_configuration(monkeypatch):
    monkeypatch.setattr(settings, "ZALO_AGENT_BRIDGE_URL", None)
    monkeypatch.setattr(settings, "ZALO_AGENT_BRIDGE_TOKEN", None)

    with pytest.raises(HTTPException) as exc:
        await zalo_agent.bridge_request("GET", "/status")

    assert exc.value.status_code == 503


@pytest.mark.anyio
async def test_bridge_sends_bearer_token(monkeypatch):
    monkeypatch.setattr(settings, "ZALO_AGENT_BRIDGE_URL", "http://bridge.local")
    monkeypatch.setattr(settings, "ZALO_AGENT_BRIDGE_TOKEN", "secret")

    class Response:
        status_code = 200

        @staticmethod
        def json():
            return {"available": True}

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def request(self, method, url, json=None, headers=None):
            assert method == "GET"
            assert url == "http://bridge.local/status"
            assert headers == {"Authorization": "Bearer secret"}
            return Response()

    monkeypatch.setattr(zalo_agent.httpx, "AsyncClient", lambda timeout: Client())
    assert await zalo_agent.bridge_request("GET", "/status") == {"available": True}


def test_bridge_timeout_is_reported_as_unavailable(monkeypatch):
    request = httpx.Request("POST", "http://bridge/resolve-recipients")
    monkeypatch.setattr(settings, "ZALO_AGENT_BRIDGE_URL", "http://bridge")
    monkeypatch.setattr(settings, "ZALO_AGENT_BRIDGE_TOKEN", "token")
    monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: FakeClient(error=httpx.ReadTimeout("timeout", request=request)))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(bridge_request("POST", "/resolve-recipients", {}))

    assert exc.value.status_code == 503
    assert exc.value.detail == "Không kết nối được Zalo Agent Bridge"


def test_bridge_5xx_keeps_request_id(monkeypatch):
    request = httpx.Request("POST", "http://bridge/resolve-recipients")
    response = httpx.Response(502, request=request, json={"request_id": "req-123", "error": "lookup failed"})
    monkeypatch.setattr(settings, "ZALO_AGENT_BRIDGE_URL", "http://bridge")
    monkeypatch.setattr(settings, "ZALO_AGENT_BRIDGE_TOKEN", "token")
    monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: FakeClient(response=response))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(bridge_request("POST", "/resolve-recipients", {}))

    assert exc.value.status_code == 502
    assert exc.value.detail == "lookup failed (request_id: req-123)"
