import uuid
from datetime import datetime, timedelta, timezone

from app.models import Guest, ZaloOaUser
from app.services.zalo_name_match import Candidate, is_auto, norm_name, score_candidate

NOW = datetime(2026, 11, 13, 5, 0, tzinfo=timezone.utc)


def _oa(name="Sơn Uyên", avatar=None):
    return ZaloOaUser(user_id="u1", display_name=name, avatar=avatar, created_at=NOW, last_event_at=NOW)


def _cand(days_before=1, avatar=None, phone="0973123230"):
    g = Guest(id=uuid.uuid4(), full_name="x", phone=phone, created_at=NOW - timedelta(days=days_before))
    return Candidate(guest=g, phone=phone, name="Sơn Uyên", avatar=avatar)


def test_norm_name_keeps_vietnamese_marks_and_strips_noise():
    assert norm_name("  Sơn   UYÊN 🌸 ") == "sơn uyên"
    assert norm_name("Sơn Uyên") != norm_name("Son Uyen")  # không bỏ dấu: tránh ghép nhầm


def test_recent_registration_unique_two_word_name_auto_links():
    c = score_candidate(_cand(1), _oa(), zns_recent=True)
    assert c.score >= 0.8 and is_auto([c], _oa(), same_name_pending=1)


def test_single_word_name_or_old_registration_only_suggests():
    assert not is_auto([score_candidate(_cand(1), _oa("Uyên"), True)], _oa("Uyên"), 1)
    old = score_candidate(_cand(60), _oa(), False)
    assert old.score < 0.8 and not is_auto([old], _oa(), 1)


def test_multiple_candidates_or_duplicate_pending_names_never_auto():
    a, b = score_candidate(_cand(1), _oa(), True), score_candidate(_cand(1, phone="0900000001"), _oa(), True)
    assert not is_auto([a, b], _oa(), 1)
    assert not is_auto([a], _oa(), same_name_pending=2)


def test_avatar_match_allows_auto_even_for_short_name():
    oa = _oa("Uyên", avatar="https://s120-ava.zadn.vn/a/b/abc123.jpg")
    c = score_candidate(_cand(30, avatar="https://s240-ava.zadn.vn/x/abc123.jpg"), oa, False)
    assert "Trùng ảnh đại diện" in c.reasons and is_auto([c], oa, 1)
