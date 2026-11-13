from datetime import date, datetime, time, timezone

from app.models import Workshop, ZbsDelivery
from app.services.zbs import _checkin_time, _payload_error, _workshop_time, normalize_phone, zbs_phone


def test_normalize_vietnamese_phone_formats():
    assert normalize_phone("+84 909 123 456") == "0909123456"
    assert normalize_phone("84909123456") == "0909123456"
    assert normalize_phone("0909.123.456") == "0909123456"


def test_normalize_empty_phone():
    assert normalize_phone(None) == ""


def test_zbs_phone_uses_country_code():
    assert zbs_phone("0909.123.456") == "84909123456"


def test_workshop_time_matches_template_format():
    workshop = Workshop(
        name="Workshop",
        slug="workshop",
        event_date=date(2026, 7, 17),
        event_time=time(9, 0),
    )
    assert _workshop_time(workshop) == "09:00 17/07/2026"


def test_checkin_time_matches_template_format_in_vietnam_timezone():
    checked_in_at = datetime(2026, 7, 21, 6, 0, tzinfo=timezone.utc)
    assert _checkin_time(checked_in_at) == "13:00 21/07/2026"


def test_checkin_payload_requires_template_parameters():
    delivery = ZbsDelivery(
        event_type="checkin_confirmation",
        event_key="checkin_confirmation:guest",
        payload={"template_data": {
            "customer_name": "Nguyễn Văn A",
            "workshop": "Workshop",
            "customer_checkin_time": "13:00 21/07/2026",
        }},
    )
    assert _payload_error(delivery) is None


def test_checkin_payload_rejects_missing_checkin_time():
    delivery = ZbsDelivery(
        event_type="checkin_confirmation",
        event_key="checkin_confirmation:guest",
        payload={"template_data": {"customer_name": "Nguyễn Văn A", "workshop": "Workshop"}},
    )
    assert _payload_error(delivery) == "missing template parameter: customer_checkin_time"


def test_checkin_payload_does_not_require_actual_party_size():
    delivery = ZbsDelivery(
        event_type="checkin_confirmation",
        event_key="checkin_confirmation:guest",
        payload={"template_data": {
            "customer_name": "Nguyễn Văn A",
            "workshop": "Workshop",
            "customer_checkin_time": "13:00 21/07/2026",
        }},
    )
    assert "customer_qty_checkin" not in delivery.payload["template_data"]


from app.models import Guest
from app.services.zbs_bulk import default_mapping, render_template_data, validate_mapping

REGISTRATION_PARAMS = [
    {"name": "customer_name", "type": "STRING", "require": True, "maxLength": 30},
    {"name": "workshop", "type": "STRING", "require": True, "maxLength": 30},
    {"name": "customer_phone", "type": "STRING", "require": True, "maxLength": 15},
    {"name": "workshop_time", "type": "DATE", "require": True, "maxLength": 20},
    {"name": "customer_qty", "type": "NUMBER", "require": True, "maxLength": 20},
]


def _bulk_guest(**values):
    return Guest(full_name="Nguyễn Văn A", phone="0909.123.456", party_size=2, **values)


def _bulk_workshop():
    return Workshop(name="Workshop trà", slug="tra", event_date=date(2026, 7, 17), event_time=time(9, 0))


def test_bulk_default_mapping_uses_known_guest_and_workshop_fields():
    mapping = default_mapping(REGISTRATION_PARAMS + [{"name": "voucher_code", "type": "STRING"}])
    assert mapping["customer_name"]["source"] == "guest.full_name"
    assert mapping["customer_qty"]["source"] == "guest.party_size"
    assert mapping["voucher_code"]["source"] == "fixed"


def test_bulk_render_template_data_per_guest():
    data, errors = render_template_data(
        REGISTRATION_PARAMS, default_mapping(REGISTRATION_PARAMS), _bulk_guest(), _bulk_workshop(),
    )
    assert errors == []
    assert data == {
        "customer_name": "Nguyễn Văn A",
        "workshop": "Workshop trà",
        "customer_phone": "84909123456",
        "workshop_time": "09:00 17/07/2026",
        "customer_qty": 2,
    }


def test_bulk_render_clips_guest_name_but_rejects_long_fixed_value():
    params = [
        {"name": "customer_name", "type": "STRING", "require": True, "maxLength": 5},
        {"name": "code", "type": "STRING", "require": True, "maxLength": 3},
    ]
    mapping = {"customer_name": {"source": "guest.full_name"}, "code": {"source": "fixed", "value": "ABCD"}}
    data, errors = render_template_data(params, mapping, _bulk_guest(), _bulk_workshop())
    assert data == {"customer_name": "Nguyễ"}
    assert errors == ["Tham số code vượt quá 3 ký tự"]
    assert validate_mapping(params, mapping) == ["Tham số code vượt quá 3 ký tự"]


def test_bulk_render_requires_values_and_numbers():
    params = [
        {"name": "customer_checkin_time", "type": "DATE", "require": True, "maxLength": 20},
        {"name": "point", "type": "NUMBER", "require": True},
    ]
    mapping = {"customer_checkin_time": {"source": "guest.checked_in_at"}, "point": {"source": "fixed", "value": "12a"}}
    _, errors = render_template_data(params, mapping, _bulk_guest(), _bulk_workshop())
    assert errors == ["Thiếu giá trị cho tham số customer_checkin_time", "Tham số point phải là số"]


def test_bulk_mapping_rejects_unknown_source():
    assert validate_mapping(REGISTRATION_PARAMS[:1], {"customer_name": {"source": "guest.password"}}) == [
        "Nguồn dữ liệu không hợp lệ cho tham số customer_name",
    ]


def test_bulk_payload_skips_registration_parameter_rules():
    delivery = ZbsDelivery(
        event_type="bulk_campaign",
        event_key="bulk_campaign:batch:guest",
        payload={"template_data": {"order_code": "A1"}},
    )
    assert _payload_error(delivery) is None


# ───── Thứ tự ưu tiên gửi: UID Zalo (nếu có) → SĐT ─────
import asyncio
import uuid

import httpx

from app.services import zbs as zbs_service


def _bulk_delivery(phone="0909123456", **payload):
    return ZbsDelivery(
        id=uuid.uuid4(), event_type="bulk_campaign", event_key="bulk_campaign:x", phone=phone, template_id="555",
        payload={"template_data": {"name": "A"}, **payload},
    )


def _run_send(monkeypatch, delivery, uid, responses):
    calls = []

    async def fake_request(db, client, method, url, **kwargs):
        calls.append((url, kwargs["json"]))
        status, body = responses[len(calls) - 1]
        return httpx.Response(status, json=body)

    async def fake_uid(db, phone):
        return uid

    monkeypatch.setattr(zbs_service.settings, "ZBS_ENABLED", True)
    monkeypatch.setattr(zbs_service.settings, "ZBS_SEND_VIA_UID", True)
    monkeypatch.setattr(zbs_service, "request_with_token", fake_request)
    monkeypatch.setattr(zbs_service, "recipient_uid", fake_uid)
    result = asyncio.run(zbs_service._send(None, delivery))
    return result, calls


def test_send_prefers_uid_when_known(monkeypatch):
    delivery = _bulk_delivery()
    (ok, _, data, error), calls = _run_send(monkeypatch, delivery, "uid-1", [(200, {"error": 0, "data": {"message_id": "m1"}})])
    assert ok and error is None
    assert len(calls) == 1
    url, body = calls[0]
    assert url == zbs_service.settings.ZBS_UID_API_URL
    assert body == {"user_id": "uid-1", "template_id": "555", "template_data": {"name": "A"}}
    assert delivery.payload["sent_via"] == "uid" and delivery.recipient_uid == "uid-1"


def test_send_falls_back_to_phone_when_uid_rejected(monkeypatch):
    delivery = _bulk_delivery()
    (ok, _, _, error), calls = _run_send(monkeypatch, delivery, "uid-1", [
        (200, {"error": -1124, "message": "template not support uid"}),
        (200, {"error": 0, "data": {"msg_id": "p1"}}),
    ])
    assert ok and error is None
    assert [url for url, _ in calls] == [zbs_service.settings.ZBS_UID_API_URL, zbs_service.settings.ZBS_API_URL]
    assert calls[1][1]["phone"] == "84909123456" and calls[1][1]["tracking_id"] == str(delivery.id)
    assert delivery.payload["sent_via"] == "phone"
    assert delivery.payload["uid_error"] == "template not support uid"


def test_send_does_not_fall_back_on_transient_uid_error(monkeypatch):
    delivery = _bulk_delivery()
    (ok, retryable, _, error), calls = _run_send(monkeypatch, delivery, "uid-1", [(503, {"error": -1, "message": "busy"})])
    assert not ok and retryable
    assert len(calls) == 1 and error == "UID: busy"


def test_send_uses_phone_without_uid(monkeypatch):
    delivery = _bulk_delivery()
    (ok, _, _, _), calls = _run_send(monkeypatch, delivery, None, [(200, {"error": 0, "data": {"msg_id": "p1"}})])
    assert ok and [url for url, _ in calls] == [zbs_service.settings.ZBS_API_URL]
    assert delivery.payload["sent_via"] == "phone" and "uid_error" not in delivery.payload


def test_send_uid_only_guest_uses_uid_from_payload(monkeypatch):
    delivery = _bulk_delivery(phone=None, uid="uid-9")
    (ok, _, _, _), calls = _run_send(monkeypatch, delivery, None, [(200, {"error": 0, "data": {"message_id": "m9"}})])
    assert ok and calls[0][1]["user_id"] == "uid-9"


def test_evaluate_recipients_marks_uid_channel(monkeypatch):
    from app.models import ZbsTemplate
    from app.services import zalo_uid, zbs_bulk

    a = _bulk_guest(id=uuid.uuid4())
    b = Guest(id=uuid.uuid4(), full_name="B", phone="917096809", party_size=1)  # SĐT thiếu số 0 nhưng có UID
    c = Guest(id=uuid.uuid4(), full_name="C", phone="0911222333", party_size=1)

    async def fake_previous(db, template_id, guest_ids):
        return {}

    async def fake_uids(db, guests):
        return {a.id: ("uid-a", None, None, "oa"), b.id: ("uid-b", None, None, "oa")}

    monkeypatch.setattr(zbs_bulk, "previous_bulk_statuses", fake_previous)
    monkeypatch.setattr(zalo_uid, "uids_for_guests", fake_uids)
    monkeypatch.setattr(zbs_bulk.settings, "ZBS_SEND_VIA_UID", True)
    template = ZbsTemplate(template_id="555", detail={"listParams": [{"name": "name", "type": "STRING", "maxLength": 30}]})
    rows = asyncio.run(zbs_bulk.evaluate_recipients(None, template, _bulk_workshop(), [a, b, c], {"name": {"source": "guest.full_name"}}))
    by = {row["full_name"]: row for row in rows}
    assert by["Nguyễn Văn A"]["channel"] == "uid" and by["Nguyễn Văn A"]["eligible"]
    assert by["B"]["channel"] == "uid" and by["B"]["eligible"] and by["B"]["phone"] is None
    assert by["C"]["channel"] == "phone" and by["C"]["zalo_uid"] is None
