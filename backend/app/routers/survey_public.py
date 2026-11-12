"""Survey công khai /survey/:slug — không cookie, xác thực bằng session token (header)."""
import hashlib
import secrets
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import GiftClaim, GiftConfig, Survey, SurveyResponse, SurveyResponseItem, SurveySession, SurveyVersion, Workshop
from ..services import gifts as gift_svc
from ..services import surveys as svc
from ..services.public_rate_limit import client_address, hit
from ..services.survey_text import is_valid_vn_mobile, mask_phone, normalize_phone

router = APIRouter(prefix="/api/public/surveys", tags=["survey-public"])

SESSION_HEADER = "X-Survey-Session"
MAX_DRAFT_BYTES = 64 * 1024


class SessionIn(BaseModel):
    full_name: str = Field(max_length=120)
    phone: str = Field(max_length=32)


class DraftIn(BaseModel):
    draft: dict
    revision: int | None = None


def _token_hash(token: str) -> str:
    return hashlib.sha256(f"survey-session:{token}".encode()).hexdigest()


async def _published(db: AsyncSession, slug: str) -> tuple[Survey, SurveyVersion]:
    survey = (await db.execute(select(Survey).where(Survey.slug == slug.lower()))).scalar_one_or_none()
    if survey is None or survey.current_version_id is None or survey.status == "draft":
        raise HTTPException(404, "not_found")
    version = await db.get(SurveyVersion, survey.current_version_id)
    if version is None:
        raise HTTPException(404, "not_found")
    return survey, version


async def _session(db: AsyncSession, survey: Survey, token: str | None, *, lock: bool = False) -> SurveySession:
    if not token or len(token) > 128:
        raise HTTPException(401, "session_required")
    query = select(SurveySession).where(SurveySession.token_hash == _token_hash(token), SurveySession.survey_id == survey.id)
    if lock:
        query = query.with_for_update()
    session = (await db.execute(query)).scalar_one_or_none()
    if session is None:
        raise HTTPException(401, "session_invalid")
    return session


def _gift_payload(variant: str, *, config: GiftConfig | None = None, claim: GiftClaim | None = None,
                  token: str | None = None, code: str | None = None, reason: str | None = None) -> dict:
    payload = {"variant": variant, "reason": reason}
    if config is not None:
        payload.update({"gift_name": config.gift_name, "description": config.description, "instructions": config.instructions})
    if claim is not None:
        payload.update({
            "status": gift_svc.effective_status(claim, config),
            "gift_name": claim.gift_name_snapshot or payload.get("gift_name"),
            "expires_at": claim.expires_at.isoformat() if claim.expires_at else None,
            "redeemed_at": claim.redeemed_at.isoformat() if claim.redeemed_at else None,
        })
    if token and code:
        payload.update({"qr": gift_svc.QR_PREFIX + token, "code": gift_svc.format_code(code)})
    return payload


async def _submission_payload(db: AsyncSession, survey: Survey, session: SurveySession) -> dict | None:
    response = (await db.execute(select(SurveyResponse).where(SurveyResponse.session_id == session.id))).scalar_one_or_none()
    if response is None:
        return None
    config = await db.get(GiftConfig, survey.workshop_id)
    claim = (await db.execute(select(GiftClaim).where(GiftClaim.response_id == response.id))).scalar_one_or_none()
    if claim is not None:
        gift = _gift_payload("gift", config=config, claim=claim)
    elif config is not None and config.enabled:
        gift = _gift_payload("ineligible", config=config, reason="not_eligible")
    else:
        gift = _gift_payload("none")
    quota, used = await gift_svc.phone_quota(db, survey.id, survey.workshop_id, session.phone)
    return {
        "submitted_at": response.submitted_at.isoformat(), "rating": response.rating,
        "favorite_count": response.favorite_count, "gift": gift,
        "quota": quota, "remaining": max(0, quota - used),
    }


async def _session_payload(db: AsyncSession, survey: Survey, session: SurveySession) -> dict:
    return {
        "full_name": session.full_name, "phone_masked": mask_phone(session.phone),
        "status": session.status, "draft": session.draft or {}, "revision": session.draft_revision,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
        "submission": await _submission_payload(db, survey, session) if session.status == "submitted" else None,
    }


def _require_open(survey: Survey) -> None:
    state = svc.public_state(survey)
    if state == "closed":
        raise HTTPException(409, "closed")
    if state == "not_open":
        raise HTTPException(409, "not_open")


@router.get("/{slug}")
async def get_public_survey(slug: str, request: Request, db: AsyncSession = Depends(get_db)):
    # Cả hội trường thường chung một IP (Wi-Fi/NAT, reverse proxy) nên giới hạn IP rộng;
    # giới hạn chặt nằm ở mức SĐT và mức phiên.
    await hit("survey:get", client_address(request), 1500, 60)
    survey, version = await _published(db, slug)
    config = await db.get(GiftConfig, survey.workshop_id)
    return {
        "state": svc.public_state(survey),
        "opens_at": survey.opens_at.isoformat() if survey.opens_at else None,
        "closes_at": survey.closes_at.isoformat() if survey.closes_at else None,
        "closed_at": survey.closed_at.isoformat() if survey.closed_at else None,
        "version_id": str(version.id),
        "gift_enabled": bool(config and config.enabled),
        **svc.public_snapshot(version.snapshot),
    }


@router.post("/{slug}/sessions", status_code=201)
async def start_session(slug: str, body: SessionIn, request: Request, db: AsyncSession = Depends(get_db)):
    address = client_address(request)
    await hit("survey:session:ip", address, 400, 600)
    survey, version = await _published(db, slug)
    _require_open(survey)
    name = " ".join(body.full_name.split())
    if not 2 <= len(name) <= 40:
        raise HTTPException(422, "Tên cần từ 2 đến 40 ký tự.")
    if not is_valid_vn_mobile(body.phone):
        raise HTTPException(422, "Số điện thoại chưa đúng — kiểm tra lại 10 số, bắt đầu bằng 0.")
    phone = normalize_phone(body.phone)
    await hit("survey:session:phone", f"{survey.id}:{phone}", 10, 600)
    quota, used = await gift_svc.phone_quota(db, survey.id, survey.workshop_id, phone)
    if quota == 0:
        raise HTTPException(403, "not_checked_in")
    if used >= quota:
        raise HTTPException(409, "quota_reached")
    token = secrets.token_urlsafe(32)
    session = SurveySession(survey_id=survey.id, version_id=version.id, token_hash=_token_hash(token),
                            full_name=name, phone=phone, draft={}, status="draft")
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return {"token": token, "session": await _session_payload(db, survey, session)}


@router.get("/{slug}/session")
async def get_session(slug: str, request: Request, db: AsyncSession = Depends(get_db),
                      x_survey_session: str | None = Header(default=None)):
    await hit("survey:session:get", client_address(request), 1500, 60)
    survey, _ = await _published(db, slug)
    session = await _session(db, survey, x_survey_session)
    return await _session_payload(db, survey, session)


@router.put("/{slug}/session")
async def save_draft(slug: str, body: DraftIn, request: Request, db: AsyncSession = Depends(get_db),
                     x_survey_session: str | None = Header(default=None)):
    if len((request.headers.get("content-length") or "0")) and int(request.headers.get("content-length") or 0) > MAX_DRAFT_BYTES:
        raise HTTPException(413, "Nháp quá lớn.")
    survey, version = await _published(db, slug)
    session = await _session(db, survey, x_survey_session, lock=True)
    await hit("survey:draft", str(session.id), 240, 60)
    if session.status == "submitted":
        raise HTTPException(409, "already_submitted")
    _require_open(survey)
    session.draft = svc.sanitize_draft(body.draft, version.snapshot)
    session.draft_revision += 1
    session.version_id = version.id
    session.updated_at = svc.now_utc()
    await db.commit()
    return {"revision": session.draft_revision, "saved_at": session.updated_at.isoformat()}


@router.delete("/{slug}/session", status_code=204)
async def discard_session(slug: str, db: AsyncSession = Depends(get_db), x_survey_session: str | None = Header(default=None)):
    """“Không phải tôi?” — xoá nháp chưa gửi trên máy chủ."""
    survey, _ = await _published(db, slug)
    session = await _session(db, survey, x_survey_session, lock=True)
    if session.status == "draft":
        await db.delete(session)
        await db.commit()


@router.post("/{slug}/submit")
async def submit(slug: str, body: DraftIn, request: Request, db: AsyncSession = Depends(get_db),
                 x_survey_session: str | None = Header(default=None)):
    survey, version = await _published(db, slug)
    session = await _session(db, survey, x_survey_session, lock=True)
    await hit("survey:submit", str(session.id), 10, 600)
    if session.status == "submitted":
        # Gửi lại do mạng chập chờn: trả kết quả cũ, không tạo phiếu/quà mới.
        return {"status": "submitted", "submission": await _submission_payload(db, survey, session), "duplicate": True}
    _require_open(survey)
    snapshot = version.snapshot
    draft = svc.sanitize_draft(body.draft, snapshot)
    settings = snapshot.get("settings") or svc.default_settings()
    if settings.get("rating_required") and not draft["rating"]:
        raise HTTPException(422, "rating_required")

    await gift_svc.lock_phone(db, survey.id, session.phone)
    quota, used = await gift_svc.phone_quota(db, survey.id, survey.workshop_id, session.phone)
    if quota == 0:
        raise HTTPException(403, "not_checked_in")
    if used >= quota:
        raise HTTPException(409, "quota_reached")
    workshop = await db.get(Workshop, survey.workshop_id)
    items_by_key = svc.snapshot_items_by_key(snapshot)
    customs = [o for o in draft["others"] if o]
    response = SurveyResponse(
        survey_id=survey.id, workshop_id=survey.workshop_id, version_id=version.id, session_id=session.id,
        full_name=session.full_name, phone=session.phone, rating=draft["rating"] or None,
        adjectives=draft["adjectives"], custom_adjectives=customs,
        discomfort=draft["discomfort"] or None, expectation=draft["expectation"] or None,
        favorite_count=len(draft["favorites"]), submitted_at=svc.now_utc(),
    )
    guest = await gift_svc.registration_for(db, survey.workshop_id, session.phone)
    response.guest_id = guest.id if guest else None
    db.add(response)
    await db.flush()
    keys = list(dict.fromkeys(draft["favorites"] + list(draft["notes"].keys())))
    favs = set(draft["favorites"])
    for key in keys:
        snap = items_by_key.get(key)
        if snap is None:
            continue
        note = draft["notes"].get(key) or {}
        db.add(SurveyResponseItem(
            response_id=response.id, item_key=key, item_type=snap["type"], source_id=uuid.UUID(snap["source_id"]),
            name_snapshot=snap["name"], group_snapshot=svc.group_title(snapshot, snap), favorited=key in favs,
            note_tags=note.get("tags") or [], note_text=note.get("text") or None,
        ))
    issued = await gift_svc.issue_for_response(db, workshop, response)
    session.status = "submitted"
    session.submitted_at = response.submitted_at
    session.draft = draft
    session.updated_at = svc.now_utc()
    await db.commit()

    config = await db.get(GiftConfig, survey.workshop_id)
    if issued.variant == "gift":
        gift = _gift_payload("gift", config=config, claim=issued.claim, token=issued.token, code=issued.code)
    elif issued.variant == "ineligible":
        gift = _gift_payload("ineligible", config=config, reason=issued.reason)
    else:
        gift = _gift_payload("none")
    return {"status": "submitted", "submission": {
        "submitted_at": response.submitted_at.isoformat(), "rating": response.rating,
        "favorite_count": response.favorite_count, "gift": gift,
        "quota": quota, "remaining": max(0, quota - used - 1),
    }}


@router.post("/{slug}/gift/reissue")
async def reissue_gift(slug: str, db: AsyncSession = Depends(get_db), x_survey_session: str | None = Header(default=None)):
    """Thiết bị mất mã (xoá bộ nhớ trình duyệt): cấp mã mới cho đúng phiên, mã cũ mất hiệu lực."""
    survey, _ = await _published(db, slug)
    session = await _session(db, survey, x_survey_session)
    await hit("survey:reissue", str(session.id), 5, 600)
    response = (await db.execute(select(SurveyResponse).where(SurveyResponse.session_id == session.id))).scalar_one_or_none()
    claim = (await db.execute(
        select(GiftClaim).where(GiftClaim.response_id == response.id).with_for_update()
    )).scalar_one_or_none() if response else None
    if claim is None:
        raise HTTPException(404, "no_gift")
    config = await db.get(GiftConfig, survey.workshop_id)
    status = gift_svc.effective_status(claim, config)
    if status != "issued":
        await db.commit()
        return {"gift": _gift_payload("gift", config=config, claim=claim)}
    token, code = await gift_svc.reissue(db, claim)
    await db.commit()
    return {"gift": _gift_payload("gift", config=config, claim=claim, token=token, code=code)}
