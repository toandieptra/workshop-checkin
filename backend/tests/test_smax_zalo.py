import asyncio
import uuid

import pytest

from app.models import ZaloDeliveryItem
from app.services import smax, zalo_messages


def test_phone84_normalizes_vietnamese_numbers():
    assert smax.phone84("0973 123 230") == "84973123230"
    assert smax.phone84("+84973123230") == "84973123230"
    assert smax.phone84("097.312.3230") == "84973123230"
    assert smax.phone84("12345") is None


@pytest.mark.parametrize("body,expected", [
    ({"data": {"error_code": 0, "data": {"uid": "123", "display_name": "Sơn Uyên"}}}, {"uid": "123", "display_name": "Sơn Uyên"}),
    ({"data": {"decodedData": {"error_code": 216, "error_message": "User không hợp lệ"}}}, None),
    ({"data": {"decodedData": {"error_code": 219}}}, None),
    (None, None),
])
def test_find_friend_parses_smax_wrapped_zalo_result(monkeypatch, body, expected):
    seen = {}

    async def fake_request(method, path, json=None, **kw):
        seen["path"] = path
        return body

    monkeypatch.setattr(smax, "_request", fake_request)
    out = asyncio.run(smax.find_friend("zlw1", "0973123230"))
    assert seen["path"] == "/pages/zlw1/friend?phone=84973123230"
    if expected is None:
        assert out is None
    else:
        assert out["uid"] == expected["uid"] and out["display_name"] == expected["display_name"]


def test_send_block_splits_caption_from_images_and_requires_https(monkeypatch):
    calls = []

    async def fake_send(page_pid, uid, content):
        calls.append(content)
        return {"data": {"msgId": f"m{len(calls)}"}}

    monkeypatch.setattr(smax, "send_zaloweb", fake_send)
    monkeypatch.setattr(zalo_messages.settings, "PUBLIC_BASE_URL", "https://workshop.example.com")
    item = ZaloDeliveryItem(id=uuid.uuid4(), recipient_id="u1", message_ids=[], block_position=0,
                            block_payload={"type": "image_album", "images": [{"url": "/uploads/a.jpg"}], "caption": "Chào"})
    asyncio.run(zalo_messages._send_block_smax(item, "zlw1"))
    assert calls == [{"images": ["https://workshop.example.com/uploads/a.jpg"]}, {"message": "Chào"}]
    assert item.status == "sent" and item.message_ids == ["m1", "m2"]

    monkeypatch.setattr(zalo_messages.settings, "PUBLIC_BASE_URL", "http://localhost:8427")
    item2 = ZaloDeliveryItem(id=uuid.uuid4(), recipient_id="u1", message_ids=[], block_position=0,
                             block_payload={"type": "image_album", "images": [{"url": "/uploads/a.jpg"}]})
    with pytest.raises(ValueError):
        asyncio.run(zalo_messages._send_block_smax(item2, "zlw1"))


from app.models import Guest
from app.services import smax_blocks


BLOCK = {"id": "b1", "name": "Spam", "platform": "zaloweb", "cards": [
    {"id": "c2", "type": "zaloweb_message", "weight": 2, "config": {"text": "", "images": ["https://cdn.smax.in/a.jpg"]}},
    {"id": "c1", "type": "zaloweb_message", "weight": 1, "config": {"text": "Chào {{name}} — hẹn ở {{workshop_name}}", "images": []}},
    {"id": "c3", "type": "zaloweb_request_friend", "weight": 3, "config": {}},
]}


def test_smax_block_to_contents_orders_cards_and_splits_text_images():
    contents = zalo_messages.smax_block_contents(BLOCK)
    assert contents == [{"type": "text", "text": "Chào {{name}} — hẹn ở {{workshop_name}}"},
                        {"type": "image_album", "images": [{"url": "https://cdn.smax.in/a.jpg"}]}]
    assert zalo_messages.unknown_placeholders(contents) == []
    rendered = zalo_messages.render_smax_block(contents[0], {"full_name": "Minh Anh", "workshop_name": "Vũng Tàu"})
    assert rendered["text"] == "Chào Minh Anh — hẹn ở Vũng Tàu"
    assert zalo_messages.unknown_placeholders([{"type": "text", "text": "{{ma_don}}"}]) == ["ma_don"]


def test_dedupe_by_phone_keeps_first_registration():
    gs = [Guest(id=uuid.uuid4(), full_name="A", phone="0973 123 230"), Guest(id=uuid.uuid4(), full_name="B", phone="+84973123230"),
          Guest(id=uuid.uuid4(), full_name="C", phone="0900000001")]
    out, dupes = zalo_messages.dedupe_by_phone(gs)
    assert [g.full_name for g in out] == ["A", "C"] and dupes == 1


def test_token_expiry_reads_jwt_exp():
    import base64, json as _j
    payload = base64.urlsafe_b64encode(_j.dumps({"exp": 1795000000}).encode()).decode().rstrip("=")
    assert smax_blocks.token_expiry(f"x.{payload}.y").year == 2026
    assert smax_blocks.token_expiry("not-a-jwt") is None


def test_db_api_token_overrides_env(monkeypatch):
    from app.services import smax
    monkeypatch.setattr(smax.settings, "SMAX_API_TOKEN", "env-token-xxxxxxxxxxxx")
    monkeypatch.setattr(smax.settings, "SMAX_BIZ_ALIAS", "dieptra")
    try:
        smax.set_db_api_token(None)
        assert smax.api_token() == "env-token-xxxxxxxxxxxx" and smax.api_token_source() == "env"
        smax.set_db_api_token("db-token-yyyyyyyyyyyy")
        assert smax.api_token() == "db-token-yyyyyyyyyyyy" and smax.api_token_source() == "db" and smax.configured()
        monkeypatch.setattr(smax.settings, "SMAX_API_TOKEN", None)
        smax.set_db_api_token(None)
        assert not smax.configured() and smax.api_token_source() is None
    finally:
        smax.set_db_api_token(None)


def test_mask_token():
    from app.routers.smax_blocks import _clean, _mask
    assert _mask("abcdefghijklmnop") == "••••••••mnop"
    assert _mask("short") is None and _mask(None) is None
    assert _clean("  Bearer abc.def ") == "abc.def"


def test_token_expiry_far_future_is_none():
    import base64, json
    from app.services.smax_blocks import token_expiry
    def jwt(exp):
        p = base64.urlsafe_b64encode(json.dumps({"exp": exp}).encode()).decode().rstrip("=")
        return f"h.{p}.s"
    assert token_expiry(jwt(317317317317)) is None          # năm ~12025 (partner token Smax)
    assert token_expiry(jwt(1795427454)).year == 2026       # giây
    assert token_expiry(jwt(1795427454000)).year == 2026    # mili-giây
