import uuid
from datetime import datetime, timedelta, timezone

from app.models import GiftClaim, GiftConfig, Guest, Survey
from app.services import gifts, surveys
from app.services.survey_text import is_valid_vn_mobile, mask_phone, normalize_phone, search_key, slugify


def test_search_key_strips_vietnamese_marks():
    assert search_key("Trân Châu Đào Nhân Phô Mai") == "tran chau dao nhan pho mai"
    assert slugify("Workshop Chuyển LerMao x Sri/Mar") == "workshop-chuyen-lermao-x-sri-mar"


def test_phone_rules():
    assert normalize_phone("+84 912.345.678") == "0912345678"
    assert is_valid_vn_mobile("0912 345 678")
    assert not is_valid_vn_mobile("0212345678")
    assert not is_valid_vn_mobile("0912345")
    assert mask_phone("0912345678") == "09•• ••• 678"


def test_parse_gift_input_accepts_qr_and_manual_code_only():
    token = gifts.new_token()
    assert gifts.parse_input(gifts.QR_PREFIX + token) == ("token", token)
    assert gifts.parse_input("smec-l47c") == ("code", "SMECL47C")
    assert gifts.parse_input("LM-SMEC-L47C") == ("code", "SMECL47C")
    assert gifts.parse_input("0912345678") is None  # không bao giờ tra cứu bằng SĐT
    assert gifts.parse_input("LMG1:short") is None
    assert gifts.parse_input("SMEC-L47I") is None  # I/1/O/0 không có trong bảng mã


def test_token_and_code_hashes_are_salted_and_distinct():
    assert gifts.hash_token("ABC") != gifts.hash_code("ABC")
    assert len(gifts.hash_token("x")) == 64


def _claim(**kw):
    base = dict(id=uuid.uuid4(), workshop_id=uuid.uuid4(), status="issued", expires_at=None)
    base.update(kw)
    return GiftClaim(**base)


def test_effective_status_handles_expiry_from_claim_or_config():
    now = datetime.now(timezone.utc)
    assert gifts.effective_status(_claim(), None, now) == "issued"
    assert gifts.effective_status(_claim(expires_at=now - timedelta(seconds=1)), None, now) == "expired"
    config = GiftConfig(workshop_id=uuid.uuid4(), redeem_until=now - timedelta(minutes=1))
    assert gifts.effective_status(_claim(), config, now) == "expired"
    assert gifts.effective_status(_claim(status="redeemed", expires_at=now - timedelta(days=1)), None, now) == "redeemed"


def test_only_checked_in_registrations_qualify_and_quota_follows_party_size():
    guest = Guest(full_name="A", registration_status="confirmed", checkin_status="not_checked_in", party_size=3)
    assert not gifts.registration_meets(guest)
    assert gifts.checked_in_count(guest) == 0
    guest.checkin_status, guest.actual_party_size = "checked_in", 2
    assert gifts.registration_meets(guest)
    assert gifts.checked_in_count(guest) == 2  # theo số khách thực tế check-in, không theo số đăng ký
    guest.actual_party_size = None
    assert gifts.checked_in_count(guest) == 3
    guest.deleted_at = datetime.now(timezone.utc)
    assert not gifts.registration_meets(guest)
    assert not gifts.registration_meets(None)


def _snapshot():
    return {
        "settings": surveys.default_settings(),
        "items": [{"key": "a", "type": "product", "source_id": str(uuid.uuid4()), "name": "A", "group": "g", "sub": None}],
        "groups": [{"key": "g", "title": "G", "short_title": "G", "children": []}],
    }


def test_sanitize_draft_drops_unknown_keys_tags_and_bounds_text():
    draft = surveys.sanitize_draft({
        "favorites": ["a", "a", "zzz", 5],
        "notes": {"a": {"tags": ["Rất ngon", "evil"], "text": "x" * 500}, "zzz": {"text": "y"}},
        "adjectives": ["Ấm áp", "<script>"], "others": ["  Ngon  ", "", "extra"],
        "discomfort": "d" * 5000, "rating": 9, "ui": {"tab": "products", "evil": "1"},
    }, _snapshot())
    assert draft["favorites"] == ["a"]
    assert list(draft["notes"]) == ["a"] and draft["notes"]["a"]["tags"] == ["Rất ngon"]
    assert len(draft["notes"]["a"]["text"]) == surveys.NOTE_TEXT_MAX
    assert draft["adjectives"] == ["Ấm áp"]
    assert draft["others"] == ["Ngon", ""]
    assert len(draft["discomfort"]) == surveys.FEEDBACK_MAX
    assert draft["rating"] == 0
    assert set(draft["ui"]) == {"tab", "cat", "sub"}


def test_public_state_transitions():
    now = datetime.now(timezone.utc)
    s = Survey(status="draft", current_version_id=None)
    assert surveys.public_state(s, now) == "draft"
    s.status, s.current_version_id = "published", uuid.uuid4()
    assert surveys.public_state(s, now) == "open"
    s.opens_at = now + timedelta(hours=1)
    assert surveys.public_state(s, now) == "not_open"
    s.opens_at, s.closes_at = None, now - timedelta(seconds=1)
    assert surveys.public_state(s, now) == "closed"
    s.closes_at, s.status = None, "closed"
    assert surveys.public_state(s, now) == "closed"


def test_settings_sanitizer_disables_required_rating_when_question_off():
    raw = surveys.sanitize_settings({"questions": {"rating": False}, "rating_required": True, "adjectives": ["A", "a", " ", "B"]})
    s = Survey(settings=raw)
    merged = surveys.merged_settings(s)
    assert merged["rating_required"] is False
    assert merged["adjectives"] == ["A", "B"]
