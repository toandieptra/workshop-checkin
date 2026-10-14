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
