from app.services.guest_provenance import normalize_guest_source


def test_other_source_requires_detail():
    assert normalize_guest_source("Khác", "Bạn bè giới thiệu") == ("Khác", "Bạn bè giới thiệu")


def test_non_other_source_discards_detail():
    assert normalize_guest_source("Đại lý giới thiệu", "ignored") == ("Đại lý giới thiệu", None)
