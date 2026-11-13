import hashlib
import json

from app.services.zalo_uid import parse_webhook, verify_signature

ZALO_EVENT = {
    "app_id": "123", "event_name": "user_received_message", "timestamp": "1794541700000",
    "sender": {"id": "oa1"}, "recipient": {"id": "8812345678901234567"},
    "message": {"msg_id": "abc", "tracking_id": "6f1c0d7e-0000-4000-8000-000000000001", "delivery_time": "1794541699000"},
}


def test_parse_zalo_nested_event_extracts_uid_and_ids():
    ev = parse_webhook(ZALO_EVENT)
    assert ev.is_delivery and ev.uid == "8812345678901234567"
    assert ev.msg_id == "abc" and ev.tracking_id.endswith("0001")
    assert ev.delivered_at is not None and ev.delivered_at.year == 2026


def test_parse_legacy_flat_payload_still_works():
    ev = parse_webhook({"msg_id": "m1", "tracking_id": "t1", "delivery_time": 1794541699})
    assert ev.is_delivery and ev.msg_id == "m1" and ev.uid is None


def test_other_events_are_not_deliveries_and_carry_no_uid():
    ev = parse_webhook({**ZALO_EVENT, "event_name": "change_template_status"})
    assert not ev.is_delivery and ev.uid is None


def test_signature_matches_zalo_formula():
    raw = json.dumps(ZALO_EVENT).encode()
    mac = hashlib.sha256(f"123{raw.decode()}{ZALO_EVENT['timestamp']}secret".encode()).hexdigest()
    assert verify_signature(raw, ZALO_EVENT, f"mac={mac}", None, "secret") is True
    assert verify_signature(raw, ZALO_EVENT, "mac=deadbeef", None, "secret") is False
    assert verify_signature(raw, ZALO_EVENT, None, None, "secret") is False
    assert verify_signature(raw, ZALO_EVENT, None, None, None) is None  # chưa cấu hình → không kiểm
