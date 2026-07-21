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
