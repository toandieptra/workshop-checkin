from datetime import date, time

from app.models import Workshop, ZbsDelivery
from app.services.zbs import _payload_error, _workshop_time, normalize_phone, zbs_phone


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


def test_checkin_payload_only_requires_name_and_workshop():
    delivery = ZbsDelivery(
        event_type="checkin_confirmation",
        event_key="checkin_confirmation:guest",
        payload={"template_data": {"customer_name": "Nguyễn Văn A", "workshop": "Workshop"}},
    )
    assert _payload_error(delivery) is None


def test_checkin_payload_does_not_require_actual_party_size():
    delivery = ZbsDelivery(
        event_type="checkin_confirmation",
        event_key="checkin_confirmation:guest",
        payload={"template_data": {"customer_name": "Nguyễn Văn A", "workshop": "Workshop"}},
    )
    assert "customer_qty_checkin" not in delivery.payload["template_data"]
