import pytest
from fastapi import HTTPException

from app.config import settings
from app.services import zalo_agent


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
