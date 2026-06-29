"""Seed 1 workshop 'Workshop Chuyển' + vài guest demo (placeholder, không embedding)."""
import asyncio
from datetime import date

from sqlalchemy import select
from app.db import SessionLocal
from app.models import Workshop, Guest

GUESTS = [
    {"full_name": "Nguyễn Thị Mai", "phone": "0901234567", "company": "Trà Sữa Mai House", "role_title": "Chủ chuỗi", "guest_type": "VIP"},
    {"full_name": "Trần Văn Hùng", "phone": "0912345678", "company": "Hùng Beverage", "role_title": "Giám đốc", "guest_type": "Đối tác"},
    {"full_name": "Lê Thị Hồng", "phone": "0923456789", "company": "Hồng Coffee", "role_title": "Quản lý", "guest_type": "Khách mời"},
    {"full_name": "Phạm Minh Tuấn", "phone": "0934567890", "company": "Tuấn F&B", "role_title": "Founder", "guest_type": "VIP"},
    {"full_name": "Võ Thị Lan", "phone": "0945678901", "company": "Lan Milk Tea", "role_title": "Chủ quán", "guest_type": "Khách mời", "consent_face_recognition": False},
]


async def main():
    async with SessionLocal() as db:
        slug = "workshop-chuyen"
        w = (await db.execute(select(Workshop).where(Workshop.slug == slug))).scalar_one_or_none()
        if not w:
            w = Workshop(name="Workshop Chuyển", slug=slug, event_date=date.today(),
                         location="Hi Sweetie Việt Nam")
            db.add(w)
            await db.commit()
            await db.refresh(w)
            print(f"created workshop {w.id}")
        else:
            print(f"workshop exists {w.id}")

        existing = (await db.execute(select(Guest).where(Guest.workshop_id == w.id))).scalars().all()
        if existing:
            print(f"{len(existing)} guests already present, skip")
            return
        for g in GUESTS:
            db.add(Guest(workshop_id=w.id, **g))
        await db.commit()
        print(f"seeded {len(GUESTS)} guests")


if __name__ == "__main__":
    asyncio.run(main())
