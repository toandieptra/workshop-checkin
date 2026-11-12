"""Nghiệp vụ survey: cấu hình mặc định, snapshot phiên bản, làm sạch nháp, trạng thái mở/đóng."""
import copy
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    CatalogImage, CatalogProduct, CatalogRecipe, Survey, SurveyGroup, SurveyItem, SurveyVersion, Workshop,
)
from .survey_text import clean_text, search_key

DEFAULT_ADJECTIVES = [
    "Ấm áp", "Thân thiện", "Sôi nổi", "Sâu sắc", "Tinh tế", "Thư giãn",
    "Truyền cảm", "Dễ hiểu", "Bổ ích", "Mới lạ", "Gần gũi", "Chỉnh chu",
]
DEFAULT_NOTE_TAGS = ["Rất ngon", "Muốn đưa vào menu", "Ngọt vừa", "Hơi ngọt", "Thơm đặc trưng", "Cần thử lại"]
QUESTION_KEYS = ("favorites", "product_notes", "impressions", "discomfort", "expectation", "rating")
GROUP_TINTS = ["#FFE9EE", "#FFF3D6", "#E3F6EC", "#E6F3FD"]

DEFAULT_CONTENT = {
    "brand_line": "LERMAO",
    "tagline": "Lắng nghe khách hàng để mỗi ly trà ngày một tốt hơn",
    "greeting": (
        "Chào anh/chị! Thử món nào thấy ưng thì chạm tim để team ghi nhận nhé. "
        "Quay lại trang này bất cứ lúc nào — lựa chọn được lưu sẵn."
    ),
    "phone_helper": (
        "Team dùng số này để phản hồi góp ý và gửi công thức sau workshop. Không dùng cho mục đích khác."
    ),
    "hero_image_url": None,
    "hotline": "",
    "email": "",
    "signature": "— Team LerMao ✿",
    "thank_you": "Cảm ơn anh/chị đã dành thời gian. Mỗi góp ý đều được team đọc và phản hồi.",
    "impressions_title": "Ba tính từ mô tả workshop hôm nay — anh/chị thấy sao?",
    "impressions_hint": "Chọn những tính từ gần nhất với cảm nhận của anh/chị về không gian, nội dung, cách team dẫn dắt và sự kết nối trong buổi.",
    "discomfort_title": "Có điều gì khiến anh/chị chưa thật sự thoải mái không?",
    "discomfort_hint": "Chúng mình thật sự muốn lắng nghe — hãy cho team biết những điểm mà anh/chị thấy chưa ổn. Mọi góp ý đều có giá trị — không có gì là quá nhỏ.",
    "expectation_title": "Anh/chị đang mong điều gì từ workshop mà team mình chưa làm được?",
    "rating_title": "Mức độ hài lòng tổng thể của anh/chị?",
}
CONTENT_LIMITS = {key: (300 if key.endswith("_url") else 600) for key in DEFAULT_CONTENT}

DRAFT_MAX_FAVORITES = 500
NOTE_TEXT_MAX = 300
FEEDBACK_MAX = 1000
CUSTOM_ADJ_MAX = 40


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def default_settings() -> dict:
    return {
        "adjectives": list(DEFAULT_ADJECTIVES),
        "note_tags": list(DEFAULT_NOTE_TAGS),
        "questions": {key: True for key in QUESTION_KEYS},
        "rating_required": True,
        "custom_adjective_slots": 2,
    }


def merged_content(survey: Survey) -> dict:
    content = dict(DEFAULT_CONTENT)
    for key, value in (survey.content or {}).items():
        if key in DEFAULT_CONTENT:
            content[key] = value
    return content


def merged_settings(survey: Survey) -> dict:
    result = default_settings()
    raw = survey.settings or {}
    if isinstance(raw.get("adjectives"), list):
        result["adjectives"] = [a for a in raw["adjectives"] if isinstance(a, str) and a.strip()]
    if isinstance(raw.get("note_tags"), list):
        result["note_tags"] = [t for t in raw["note_tags"] if isinstance(t, str) and t.strip()]
    if isinstance(raw.get("questions"), dict):
        for key in QUESTION_KEYS:
            if isinstance(raw["questions"].get(key), bool):
                result["questions"][key] = raw["questions"][key]
    if isinstance(raw.get("rating_required"), bool):
        result["rating_required"] = raw["rating_required"]
    if isinstance(raw.get("custom_adjective_slots"), int):
        result["custom_adjective_slots"] = max(0, min(4, raw["custom_adjective_slots"]))
    if not result["questions"]["rating"]:
        result["rating_required"] = False
    return result


def sanitize_content(raw: dict | None) -> dict:
    out = {}
    for key, value in (raw or {}).items():
        if key not in DEFAULT_CONTENT:
            continue
        if value is None:
            out[key] = None
        elif isinstance(value, str):
            out[key] = value.strip()[:CONTENT_LIMITS[key]]
    return out


def sanitize_settings(raw: dict | None) -> dict:
    raw = raw or {}

    def str_list(values, limit, max_len):
        seen, result = set(), []
        for value in values if isinstance(values, list) else []:
            text = clean_text(value, max_len)
            if text and text.lower() not in seen:
                seen.add(text.lower())
                result.append(text)
        return result[:limit]

    questions = raw.get("questions") if isinstance(raw.get("questions"), dict) else {}
    slots = raw.get("custom_adjective_slots", 2)
    return {
        "adjectives": str_list(raw.get("adjectives", DEFAULT_ADJECTIVES), 30, 40),
        "note_tags": str_list(raw.get("note_tags", DEFAULT_NOTE_TAGS), 12, 40),
        "questions": {key: bool(questions.get(key, True)) for key in QUESTION_KEYS},
        "rating_required": bool(raw.get("rating_required", True)),
        "custom_adjective_slots": max(0, min(4, slots if isinstance(slots, int) else 2)),
    }


def public_state(survey: Survey, at: datetime | None = None) -> str:
    """open | not_open | closed — draft survey không bao giờ public."""
    at = at or now_utc()
    if survey.status == "closed":
        return "closed"
    if survey.status != "published" or not survey.current_version_id:
        return "draft"
    if survey.closes_at and at >= survey.closes_at:
        return "closed"
    if survey.opens_at and at < survey.opens_at:
        return "not_open"
    return "open"


async def load_images(db: AsyncSession, product_ids: list, recipe_ids: list) -> dict[tuple[str, uuid.UUID], list[CatalogImage]]:
    images: dict[tuple[str, uuid.UUID], list[CatalogImage]] = {}
    if product_ids or recipe_ids:
        rows = (await db.execute(
            select(CatalogImage).where(
                (CatalogImage.product_id.in_(product_ids or [uuid.UUID(int=0)]))
                | (CatalogImage.recipe_id.in_(recipe_ids or [uuid.UUID(int=0)]))
            ).order_by(CatalogImage.sort_order, CatalogImage.created_at)
        )).scalars().all()
        for image in rows:
            key = ("product", image.product_id) if image.product_id else ("recipe", image.recipe_id)
            images.setdefault(key, []).append(image)
    return images


def image_payload(image: CatalogImage, name: str) -> dict:
    return {
        "src": image.file_url, "thumb": image.thumb_url, "w": image.width, "h": image.height,
        "focus_y": image.focus_y, "alt": image.alt or name,
    }


async def build_snapshot(db: AsyncSession, survey: Survey, workshop: Workshop) -> dict:
    """Ảnh chụp toàn bộ nội dung khách thấy; lưu trong survey_versions để phiếu cũ luôn diễn giải được."""
    groups = (await db.execute(
        select(SurveyGroup).where(SurveyGroup.survey_id == survey.id).order_by(SurveyGroup.sort_order, SurveyGroup.title)
    )).scalars().all()
    items = (await db.execute(
        select(SurveyItem).where(SurveyItem.survey_id == survey.id).order_by(SurveyItem.sort_order, SurveyItem.created_at)
    )).scalars().all()
    product_ids = [i.product_id for i in items if i.product_id]
    recipe_ids = [i.recipe_id for i in items if i.recipe_id]
    products = {p.id: p for p in (await db.execute(select(CatalogProduct).where(CatalogProduct.id.in_(product_ids or [uuid.UUID(int=0)])))).scalars()}
    recipes = {r.id: r for r in (await db.execute(select(CatalogRecipe).where(CatalogRecipe.id.in_(recipe_ids or [uuid.UUID(int=0)])))).scalars()}
    images = await load_images(db, product_ids, recipe_ids)

    top = [g for g in groups if g.parent_id is None]
    children: dict[uuid.UUID, list[SurveyGroup]] = {}
    for g in groups:
        if g.parent_id:
            children.setdefault(g.parent_id, []).append(g)
    parent_of = {g.id: g.parent_id for g in groups}
    group_payload = []
    for index, g in enumerate(top):
        group_payload.append({
            "key": str(g.id), "title": g.title, "short_title": g.short_title or g.title,
            "tint": g.tint or GROUP_TINTS[index % len(GROUP_TINTS)],
            "children": [
                {"key": str(c.id), "title": c.title, "short_title": c.short_title or c.title}
                for c in children.get(g.id, [])
            ],
        })
    top_order = {g["key"]: i for i, g in enumerate(group_payload)}
    child_order = {c["key"]: i for g in group_payload for i, c in enumerate(g["children"])}

    item_payload = []
    has_ungrouped = False
    for item in items:
        source = products.get(item.product_id) if item.item_type == "product" else recipes.get(item.recipe_id)
        if source is None or source.status == "archived":
            continue
        name = (item.display_name or "").strip() or source.name
        if item.group_id and item.group_id in parent_of:
            parent = parent_of[item.group_id]
            group_key, sub_key = (str(parent), str(item.group_id)) if parent else (str(item.group_id), None)
        else:
            group_key, sub_key = "_other", None
            has_ungrouped = True
        pics = [image_payload(img, name) for img in images.get((item.item_type, source.id), [])]
        if item.image_override_url:
            pics.insert(0, {"src": item.image_override_url, "thumb": item.image_override_url, "w": None, "h": None, "focus_y": 35, "alt": name})
        item_payload.append({
            "key": str(item.id), "type": item.item_type, "source_id": str(source.id), "name": name,
            "search": search_key(name), "description": source.short_description or "",
            "group": group_key, "sub": sub_key, "images": pics[:12],
            "_order": (top_order.get(group_key, 10_000), child_order.get(sub_key, -1) if sub_key else -1, item.sort_order),
        })
    if has_ungrouped:
        group_payload.append({"key": "_other", "title": "Khác", "short_title": "Khác", "tint": "#f5f5f5", "children": []})
    item_payload.sort(key=lambda it: it.pop("_order"))
    # Ẩn nhóm rỗng để thanh tab không có mục trống.
    used = {(it["group"], it["sub"]) for it in item_payload}
    used_groups = {g for g, _ in used}
    group_payload = [
        {**g, "children": [c for c in g["children"] if (g["key"], c["key"]) in used]}
        for g in group_payload if g["key"] in used_groups
    ]
    content = merged_content(survey)
    return {
        "survey": {
            "slug": survey.slug, "title": survey.title, "workshop_name": workshop.name,
            "event_date": workshop.event_date.isoformat() if workshop.event_date else None,
            "event_time": workshop.event_time.strftime("%H:%M") if workshop.event_time else None,
            "location": workshop.location,
            **content,
        },
        "settings": merged_settings(survey),
        "groups": group_payload,
        "items": item_payload,
    }


async def publish(db: AsyncSession, survey: Survey, workshop: Workshop, user_id: uuid.UUID | None) -> SurveyVersion:
    snapshot = await build_snapshot(db, survey, workshop)
    if not snapshot["items"] and snapshot["settings"]["questions"]["favorites"]:
        raise HTTPException(400, "Chưa có sản phẩm/công thức nào trong khảo sát. Thêm món trước khi xuất bản.")
    next_no = (await db.scalar(
        select(func.coalesce(func.max(SurveyVersion.version_no), 0)).where(SurveyVersion.survey_id == survey.id)
    )) + 1
    version = SurveyVersion(survey_id=survey.id, version_no=next_no, snapshot=snapshot, published_by=user_id)
    db.add(version)
    await db.flush()
    survey.current_version_id = version.id
    survey.status = "published"
    survey.published_at = now_utc()
    survey.closed_at = None
    survey.updated_at = now_utc()
    return version


def sanitize_draft(raw: dict | None, snapshot: dict) -> dict:
    """Chỉ giữ dữ liệu hợp lệ theo phiên bản hiện hành; không tin bất kỳ trường nào từ client."""
    raw = raw if isinstance(raw, dict) else {}
    settings = snapshot.get("settings") or default_settings()
    valid_keys = {item["key"] for item in snapshot.get("items", [])}
    favorites, seen = [], set()
    for key in raw.get("favorites") or []:
        if isinstance(key, str) and key in valid_keys and key not in seen:
            seen.add(key)
            favorites.append(key)
    notes = {}
    allowed_tags = set(settings.get("note_tags") or [])
    for key, note in (raw.get("notes") or {}).items() if isinstance(raw.get("notes"), dict) else []:
        if key not in valid_keys or not isinstance(note, dict):
            continue
        tags = [t for t in dict.fromkeys(note.get("tags") or []) if isinstance(t, str) and t in allowed_tags]
        text = clean_text(note.get("text"), NOTE_TEXT_MAX)
        if tags or text:
            notes[key] = {"tags": tags, "text": text}
    allowed_adj = list(settings.get("adjectives") or [])
    adjectives = [a for a in dict.fromkeys(raw.get("adjectives") or []) if isinstance(a, str) and a in allowed_adj]
    slots = int(settings.get("custom_adjective_slots", 2))
    others = [clean_text(v, CUSTOM_ADJ_MAX) for v in (raw.get("others") or [])[:slots]]
    while len(others) < slots:
        others.append("")
    rating = raw.get("rating")
    rating = rating if isinstance(rating, int) and 1 <= rating <= 5 else 0
    ui_raw = raw.get("ui") if isinstance(raw.get("ui"), dict) else {}
    ui = {k: clean_text(ui_raw.get(k), 64) for k in ("tab", "cat", "sub")}
    return {
        "favorites": favorites[:DRAFT_MAX_FAVORITES],
        "notes": notes,
        "adjectives": adjectives,
        "others": others,
        "discomfort": clean_text(raw.get("discomfort"), FEEDBACK_MAX),
        "expectation": clean_text(raw.get("expectation"), FEEDBACK_MAX),
        "rating": rating,
        "ui": ui,
    }


def snapshot_items_by_key(snapshot: dict) -> dict[str, dict]:
    return {item["key"]: item for item in snapshot.get("items", [])}


def group_title(snapshot: dict, item: dict) -> str:
    for g in snapshot.get("groups", []):
        if g["key"] == item.get("group"):
            for c in g.get("children", []):
                if c["key"] == item.get("sub"):
                    return f"{g['short_title']} · {c['short_title']}"
            return g["title"]
    return ""


def public_snapshot(snapshot: dict) -> dict:
    return copy.deepcopy(snapshot)
