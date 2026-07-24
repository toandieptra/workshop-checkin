from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth.dependencies import require_permission
from ..services.zalo_agent import bridge_request

router = APIRouter(prefix="/api/zalo-agent", tags=["zalo-agent"])


class AccountSwitch(BaseModel):
    owner_id: str = Field(pattern=r"^[0-9]{5,30}$")


class LogoutRequest(BaseModel):
    purge: bool = False


@router.get("/status", dependencies=[Depends(require_permission("zalo_connections.read"))])
async def status():
    return await bridge_request("GET", "/status")


@router.get("/accounts", dependencies=[Depends(require_permission("zalo_connections.read"))])
async def accounts():
    return await bridge_request("GET", "/accounts")


@router.post("/login", dependencies=[Depends(require_permission("zalo_connections.manage"))])
async def login():
    return await bridge_request("POST", "/login")


@router.get("/login/{session_id}", dependencies=[Depends(require_permission("zalo_connections.manage"))])
async def login_status(session_id: str):
    if len(session_id) != 36 or any(char not in "0123456789abcdef-" for char in session_id.lower()):
        from fastapi import HTTPException
        raise HTTPException(400, "session_id không hợp lệ")
    return await bridge_request("GET", f"/login/{session_id}")


@router.post("/accounts/switch", dependencies=[Depends(require_permission("zalo_connections.manage"))])
async def switch_account(body: AccountSwitch):
    return await bridge_request("POST", "/accounts/switch", {"owner_id": body.owner_id})


@router.delete("/accounts/{owner_id}", dependencies=[Depends(require_permission("zalo_connections.manage"))])
async def remove_account(owner_id: str):
    if not owner_id.isdigit() or not 5 <= len(owner_id) <= 30:
        from fastapi import HTTPException
        raise HTTPException(400, "owner_id không hợp lệ")
    return await bridge_request("DELETE", f"/accounts/{owner_id}")


@router.post("/logout", dependencies=[Depends(require_permission("zalo_connections.manage"))])
async def logout(body: LogoutRequest):
    return await bridge_request("POST", "/logout", {"purge": body.purge})


@router.post("/reconnect", dependencies=[Depends(require_permission("zalo_connections.manage"))])
async def reconnect():
    return await bridge_request("POST", "/reconnect")
