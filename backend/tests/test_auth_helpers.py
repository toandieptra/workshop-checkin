from app.auth.session import token_hash
from app.routers.auth import _safe_return_to


def test_session_token_is_hashed_deterministically():
    assert token_hash("secret") != "secret"
    assert token_hash("secret") == token_hash("secret")


def test_return_to_only_allows_local_paths():
    assert _safe_return_to("/admin/users") == "/admin/users"
    assert _safe_return_to("https://evil.example") == "/admin"
    assert _safe_return_to("//evil.example") == "/admin"
