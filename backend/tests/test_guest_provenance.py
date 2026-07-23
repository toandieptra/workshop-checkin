import asyncio
from unittest.mock import AsyncMock, patch

from starlette.requests import Request

from app.services import guest_provenance
from app.services.guest_provenance import client_ip, normalize_guest_source


def request_with_headers(headers: list[tuple[bytes, bytes]], client: tuple[str, int] | None = None):
    scope = {"type": "http", "headers": headers}
    if client:
        scope["client"] = client
    return Request(scope)


def test_other_source_requires_detail():
    assert normalize_guest_source("Khác", "Bạn bè giới thiệu") == ("Khác", "Bạn bè giới thiệu")


def test_non_other_source_discards_detail():
    assert normalize_guest_source("Đại lý giới thiệu", "ignored") == ("Đại lý giới thiệu", None)


def test_client_ip_prefers_first_valid_forwarded_address():
    request = request_with_headers([
        (b"x-forwarded-for", b"203.0.113.8, 10.0.0.2"),
        (b"x-real-ip", b"172.28.0.5"),
    ])

    assert client_ip(request) == "203.0.113.8"


def test_client_ip_skips_invalid_proxy_values():
    request = request_with_headers([
        (b"x-forwarded-for", b"invalid, 198.51.100.20"),
        (b"x-real-ip", b"172.28.0.5"),
    ])

    assert client_ip(request) == "198.51.100.20"


def test_client_ip_falls_back_to_real_ip_then_socket():
    real_ip_request = request_with_headers(
        [(b"x-real-ip", b"198.51.100.21")],
        ("172.28.0.6", 1234),
    )
    socket_request = request_with_headers([], ("198.51.100.22", 1234))

    assert client_ip(real_ip_request) == "198.51.100.21"
    assert client_ip(socket_request) == "198.51.100.22"


def test_client_ip_returns_unknown_when_no_valid_address_exists():
    request = request_with_headers(
        [(b"x-forwarded-for", b"invalid"), (b"x-real-ip", b"also-invalid")]
    )

    assert client_ip(request) == "unknown"


class AliasDb:
    def __init__(self):
        self.aliases: dict[str, int] = {}
        self.current_ip = ""

    async def execute(self, statement):
        params = statement.compile().params
        ip_value = params.get("ip_address") or params.get("ip_address_1")
        if statement.is_insert:
            self.current_ip = ip_value
            self.aliases.setdefault(ip_value, 1001 + len(self.aliases))

        alias_number = self.aliases[ip_value]

        class Result:
            @staticmethod
            def scalar_one():
                return alias_number

        return Result()


def test_public_creator_reuses_alias_per_ip_and_increments_for_new_ip():
    db = AliasDb()
    first_request = request_with_headers([(b"x-forwarded-for", b"203.0.113.10")])
    second_request = request_with_headers([(b"x-forwarded-for", b"203.0.113.11")])

    with patch.object(guest_provenance, "optional_admin_user", AsyncMock(return_value=None)):
        first = asyncio.run(guest_provenance.resolve_public_creator(first_request, db))
        first_again = asyncio.run(guest_provenance.resolve_public_creator(first_request, db))
        second = asyncio.run(guest_provenance.resolve_public_creator(second_request, db))

    assert first == ("Người dùng 1001", None)
    assert first_again == first
    assert second == ("Người dùng 1002", None)


def test_public_creator_prefers_authenticated_admin():
    admin_id = "06c83473-2de8-4e2c-b921-eb147318d66c"

    class Admin:
        id = admin_id
        name = "Admin Name"
        email = "admin@example.com"

    with patch.object(guest_provenance, "optional_admin_user", AsyncMock(return_value=Admin())):
        creator = asyncio.run(guest_provenance.resolve_public_creator(
            request_with_headers([(b"x-forwarded-for", b"203.0.113.12")]),
            AliasDb(),
        ))

    assert creator == ("Admin Name", admin_id)
