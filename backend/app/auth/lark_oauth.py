import urllib.parse

import httpx

from ..config import settings


class LarkOAuthError(Exception):
    pass


def authorization_url(state: str) -> str:
    if not settings.LARK_APP_ID or not settings.LARK_OAUTH_REDIRECT_URI:
        raise LarkOAuthError("Lark OAuth is not configured")
    params = urllib.parse.urlencode({
        "app_id": settings.LARK_APP_ID,
        "redirect_uri": settings.LARK_OAUTH_REDIRECT_URI,
        "state": state,
    })
    return f"https://accounts.{settings.LARK_DOMAIN}/open-apis/authen/v1/authorize?{params}"


async def exchange_code(code: str) -> dict:
    if not settings.LARK_APP_ID or not settings.LARK_APP_SECRET:
        raise LarkOAuthError("Lark OAuth is not configured")
    async with httpx.AsyncClient(timeout=20.0) as client:
        token_response = await client.post(
            f"{settings.lark_base_url}/authen/v2/oauth/token",
            headers={"Content-Type": "application/json; charset=utf-8"},
            json={
                "grant_type": "authorization_code",
                "client_id": settings.LARK_APP_ID,
                "client_secret": settings.LARK_APP_SECRET,
                "code": code,
                "redirect_uri": settings.LARK_OAUTH_REDIRECT_URI,
            },
        )
        token_response.raise_for_status()
        token_data = token_response.json()
        if token_data.get("code", 0) != 0:
            raise LarkOAuthError(token_data.get("error_description") or token_data.get("msg") or "token exchange failed")
        access_token = token_data.get("access_token") or token_data.get("data", {}).get("access_token")
        if not access_token:
            raise LarkOAuthError("Lark did not return a user access token")
        user_response = await client.get(
            f"{settings.lark_base_url}/authen/v1/user_info",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        user_response.raise_for_status()
        payload = user_response.json()
        if payload.get("code", 0) != 0:
            raise LarkOAuthError(payload.get("msg") or "user info failed")
        return payload.get("data", payload)
