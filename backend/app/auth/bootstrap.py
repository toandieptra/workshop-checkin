import logging

from sqlalchemy import func, select

from ..config import settings
from ..db import SessionLocal
from ..models import AdminUser

log = logging.getLogger("auth.bootstrap")


async def bootstrap_super_admin() -> None:
    email = (settings.AUTH_BOOTSTRAP_SUPER_ADMIN_EMAIL or "").strip().lower()
    if not email:
        return
    async with SessionLocal() as db:
        user = (await db.execute(select(AdminUser).where(func.lower(AdminUser.email) == email))).scalar_one_or_none()
        if user is None:
            user = AdminUser(email=email, role="super_admin", is_active=True)
            db.add(user)
            log.warning("Pre-provisioned bootstrap super admin %s", email)
        else:
            user.role = "super_admin"
            user.is_active = True
        await db.commit()
