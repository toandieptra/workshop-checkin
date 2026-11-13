import hashlib
import json

from app.services.zalo_uid import parse_webhook, verify_signature

ZALO_EVENT = {
    "app_id": "123", "user_id_by_app": "7221", "event_name": "user_received_message", "timestamp": "1794541700000",
    "sender": {"id": "oa1"}, "recipient": {"id": "8812345678901234567"},
    "message": {"msg_id": "abc", "tracking_id": "6f1c0d7e-0000-4000-8000-000000000001", "delivery_time": "1794541699000"},
}


def test_parse_zalo_nested_event_extracts_uid_and_ids():
    ev = parse_webhook(ZALO_EVENT)
    assert ev.is_delivery and ev.uid == "8812345678901234567" and ev.uid_by_app == "7221"
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


def test_zns_phone_receipt_never_yields_uid():
    # Webhook "tin qua SĐT" (X-ZEvent-Server: ZNS): recipient.id là SĐT, không phải UID.
    zns = {**ZALO_EVENT, "recipient": {"id": "84973123230"}}
    ev = parse_webhook(zns, "ZNS")
    assert ev.is_delivery and ev.uid is None and ev.uid_by_app is None and ev.msg_id == "abc"
    assert parse_webhook(zns).uid is None  # thiếu header vẫn nhận ra dạng SĐT
    hashed = {**ZALO_EVENT, "recipient": {"id": "a" * 64}}
    assert parse_webhook(hashed).uid is None


def test_oa_event_keeps_uid():
    ev = parse_webhook(ZALO_EVENT, "OA")
    assert ev.uid == "8812345678901234567"


from app.services.zalo_oa import extract_user_event


def test_oa_follow_and_send_events_yield_user_id():
    f = extract_user_event({"event_name": "follow", "oa_id": "oa1", "user_id_by_app": "app9", "timestamp": "1794541700000",
                            "follower": {"id": "5551"}}, "OA")
    assert f.user_id == "5551" and f.follow is True and f.user_id_by_app == "app9"
    t = extract_user_event({"event_name": "user_send_text", "sender": {"id": "5552"}, "recipient": {"id": "oa1"},
                            "message": {"text": "xin chào", "msg_id": "m"}}, "OA")
    assert t.user_id == "5552" and t.phone is None


def test_oa_submit_info_carries_phone():
    ev = extract_user_event({"event_name": "user_submit_info", "sender": {"id": "5553"}, "recipient": {"id": "oa1"},
                             "info": {"phone": "84973123230", "name": "A"}}, "OA")
    assert ev.user_id == "5553" and ev.phone == "84973123230"


def test_oa_message_to_user_uses_recipient_and_skips_zns():
    ev = extract_user_event({"event_name": "user_received_message", "sender": {"id": "oa1"}, "recipient": {"id": "5554"},
                             "message": {"msg_id": "m"}}, "OA")
    assert ev.user_id == "5554"
    assert extract_user_event({"event_name": "user_received_message", "recipient": {"id": "84973123230"},
                               "message": {"msg_id": "m", "tracking_id": "t"}}, "ZNS") is None
    assert extract_user_event({"event_name": "ping"}, "OA") is None
