"""Nhân viên quét QR / nhập mã để trao quà. Quét chỉ tra cứu; trao quà cần bước xác nhận riêng."""
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import current_user
from ..auth.workshop_access import require_workshop_permission
from ..db import get_db
from ..models import AdminUser, GiftAuditLog, GiftClaim, GiftConfig, Guest, SurveyResponse
from ..services import gifts as gift_svc
from ..services.public_rate_limit import hit
from ..services.surveys import now_utc

router = APIRouter(prefix="/api/workshops/{workshop_id}/gifts", tags=["gifts"])


class LookupIn(BaseModel):
    code: str = Field(min_length=1, max_length=200)
    method: Literal["qr", "manual"] = "qr"


class RedeemIn(LookupIn):
    claim_id: uuid.UUID
    request_id: uuid.UUID


def _out(verdict: gift_svc.Verdict, info: dict | None, *, can_redeem: bool) -> dict:
    return {"result": verdict.result, "message": verdict.message, "can_redeem": can_redeem, "claim": info}


@router.post("/lookup")
async def lookup(workshop_id: uuid.UUID, body: LookupIn, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "gifts.redeem")
    await hit("gift:lookup", str(user.id), 120, 60)
    error, claim = await gift_svc.find_claim(db, body.code)
    if claim is None:
        verdict = gift_svc.Verdict(error)
        gift_svc.audit(db, workshop_id=workshop_id, claim=None, action="lookup", result=error, actor_id=user.id, detail={"method": body.method})
        await db.commit()
        return _out(verdict, None, can_redeem=False)
    verdict = await gift_svc.evaluate(db, claim, workshop_id)
    # Mã của workshop khác: không trả thông tin khách để tránh lộ dữ liệu chéo workshop.
    info = None if verdict.result == "wrong_workshop" else await gift_svc.claim_info(db, claim)
    gift_svc.audit(db, workshop_id=workshop_id, claim=claim if verdict.result != "wrong_workshop" else None,
                   action="lookup", result=verdict.result, actor_id=user.id, detail={"method": body.method})
    await db.commit()
    return _out(verdict, info, can_redeem=verdict.ok)


@router.post("/redeem")
async def redeem(workshop_id: uuid.UUID, body: RedeemIn, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    """Trao quà nguyên tử: khoá hàng claim, kiểm tra lại toàn bộ quy tắc, idempotent theo request_id."""
    await require_workshop_permission(db, user, workshop_id, "gifts.redeem")
    await hit("gift:redeem", str(user.id), 60, 60)
    error, claim = await gift_svc.find_claim(db, body.code, lock=True)
    if claim is None or claim.id != body.claim_id:
        result = error or "not_found"
        gift_svc.audit(db, workshop_id=workshop_id, claim=None, action="redeem", result=result, actor_id=user.id,
                       detail={"method": body.method, "request_id": str(body.request_id)})
        await db.commit()
        return _out(gift_svc.Verdict(result), None, can_redeem=False)

    if claim.status == "redeemed":
        # Bấm lặp / mạng gửi lại cùng request: trả thành công thay vì báo “đã dùng”.
        same_request = await db.scalar(select(GiftAuditLog.id).where(
            GiftAuditLog.claim_id == claim.id, GiftAuditLog.action == "redeem", GiftAuditLog.result == "ok",
            GiftAuditLog.detail["request_id"].astext == str(body.request_id),
        ))
        if same_request:
            await db.commit()
            return {**_out(gift_svc.Verdict("redeemed"), await gift_svc.claim_info(db, claim), can_redeem=False), "result": "redeemed"}

    verdict = await gift_svc.evaluate(db, claim, workshop_id)
    if not verdict.ok:
        info = None if verdict.result == "wrong_workshop" else await gift_svc.claim_info(db, claim)
        gift_svc.audit(db, workshop_id=workshop_id, claim=claim if verdict.result != "wrong_workshop" else None,
                       action="redeem", result=verdict.result, actor_id=user.id,
                       detail={"method": body.method, "request_id": str(body.request_id)})
        await db.commit()
        return _out(verdict, info, can_redeem=False)

    claim.status = "redeemed"
    claim.redeemed_at = now_utc()
    claim.redeemed_by = user.id
    claim.updated_at = claim.redeemed_at
    gift_svc.audit(db, workshop_id=workshop_id, claim=claim, action="redeem", result="ok", actor_id=user.id,
                   detail={"method": body.method, "request_id": str(body.request_id)})
    await db.commit()
    return {**_out(gift_svc.Verdict("redeemed"), await gift_svc.claim_info(db, claim), can_redeem=False), "result": "redeemed"}


@router.get("/guest/{guest_id}")
async def guest_gift_log(workshop_id: uuid.UUID, guest_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    """Log quà của một đăng ký: mỗi phiếu khảo sát → 1 mã quà, kèm lịch sử tra cứu/trao/thu hồi."""
    await require_workshop_permission(db, user, workshop_id, "guests.read", "gifts.redeem", "surveys.read", any_of=True)
    guest = await db.get(Guest, guest_id)
    if guest is None or guest.workshop_id != workshop_id:
        raise HTTPException(404, "Không tìm thấy khách trong workshop này.")
    config = await db.get(GiftConfig, workshop_id)
    rows = (await db.execute(
        select(GiftClaim, SurveyResponse).join(SurveyResponse, SurveyResponse.id == GiftClaim.response_id)
        .where(GiftClaim.workshop_id == workshop_id, GiftClaim.guest_id == guest_id).order_by(GiftClaim.issued_at)
    )).all()
    claim_ids = [c.id for c, _ in rows]
    logs = (await db.execute(
        select(GiftAuditLog, AdminUser.name, AdminUser.email, AdminUser.username)
        .outerjoin(AdminUser, AdminUser.id == GiftAuditLog.actor_user_id)
        .where(GiftAuditLog.claim_id.in_(claim_ids or [uuid.UUID(int=0)])).order_by(GiftAuditLog.created_at)
    )).all()
    by_claim: dict[uuid.UUID, list[dict]] = {}
    for log, name, email, username in logs:
        by_claim.setdefault(log.claim_id, []).append({
            "action": log.action, "result": log.result, "actor": name or email or username,
            "method": (log.detail or {}).get("method"), "created_at": log.created_at.isoformat(),
        })
    slots = gift_svc.checked_in_count(guest)
    claims = []
    for claim, response in rows:
        claims.append({
            "claim_id": str(claim.id), "status": gift_svc.effective_status(claim, config), "gift_name": claim.gift_name_snapshot,
            "respondent": response.full_name, "rating": response.rating, "submitted_at": response.submitted_at.isoformat(),
            "issued_at": claim.issued_at.isoformat(), "redeemed_at": claim.redeemed_at.isoformat() if claim.redeemed_at else None,
            "revoke_reason": claim.revoke_reason, "events": by_claim.get(claim.id, []),
        })
    return {
        "checked_in": slots,
        "redeemed": sum(1 for c in claims if c["status"] == "redeemed"),
        "claims": claims,
    }
