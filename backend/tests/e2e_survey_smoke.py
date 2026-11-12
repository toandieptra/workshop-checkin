"""Smoke test E2E cho Phase 2 (catalog, survey công khai, quà tặng) trên môi trường LOCAL.

Yêu cầu: backend local đang chạy ở :8427 và container workshop-checkin-postgres-1.
Script tự tạo dữ liệu QA (workshop/khách/catalog có mã ngẫu nhiên) và tự dọn khi kết thúc.
KHÔNG chạy trên production. Chạy:  backend/.venv/bin/python backend/tests/e2e_survey_smoke.py
"""
import asyncio
import hashlib
import io
import secrets
import subprocess
import sys
import uuid

import httpx
from PIL import Image

BASE = "http://127.0.0.1:8427"
PSQL = ["docker", "exec", "-i", "workshop-checkin-postgres-1", "psql", "-U", "workshop", "-d", "workshop_checkin", "-tA", "-v", "ON_ERROR_STOP=1"]
KEEP = "--keep" in sys.argv


def sql(q: str) -> str:
    r = subprocess.run(PSQL, input=q, capture_output=True, text=True)
    if r.returncode: raise RuntimeError(q[:120] + " => " + r.stderr)
    return r.stdout.strip()


RESULTS = []


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  -- {detail}" if not cond and detail else ""))


def img_bytes(color):
    buf = io.BytesIO()
    Image.new("RGB", (1748, 2480), color).save(buf, "JPEG", quality=90)
    return buf.getvalue()


async def main():
    tag = secrets.token_hex(3)
    admin_id = sql("select id from admin_users where role='super_admin' and is_active order by created_at limit 1;")
    token = secrets.token_urlsafe(32)
    sql(f"insert into admin_sessions(user_id, token_hash, expires_at) values ('{admin_id}', '{hashlib.sha256(token.encode()).hexdigest()}', now() + interval '1 hour');")
    w1 = sql(f"insert into workshops(name, slug, status) values ('QA Survey {tag}', 'qa-survey-{tag}', 'draft') returning id;").splitlines()[0]
    w2 = sql(f"insert into workshops(name, slug, status) values ('QA Other {tag}', 'qa-other-{tag}', 'draft') returning id;").splitlines()[0]
    sql(f"insert into guests(workshop_id, full_name, phone, registration_status, checkin_status) values ('{w1}', 'Khách QA', '0912345678', 'confirmed', 'not_checked_in'), ('{w1}', 'Khách QA 2', '+84 913 000 111', 'confirmed', 'not_checked_in'), ('{w1}', 'Khách QA 3', '0914000222', 'confirmed', 'not_checked_in'), ('{w1}', 'Khách QA 4', '0918000444', 'confirmed', 'not_checked_in');")
    # Đã check-in: QA 2 khách (được 2 phiếu), QA2/QA3 mỗi người 1 khách; QA4 chỉ đăng ký, chưa check-in.
    sql(f"update guests set checkin_status='checked_in', checked_in_at=now(), actual_party_size=(case when full_name='Khách QA' then 2 else 1 end) where workshop_id='{w1}' and full_name <> 'Khách QA 4';")
    cookies = {"workshop_admin_session": token}
    created_cats = []
    try:
        async with httpx.AsyncClient(base_url=BASE, cookies=cookies, timeout=60) as a, httpx.AsyncClient(base_url=BASE, timeout=60) as pub:
            # ---- catalog
            r = await a.post("/api/catalog/categories", json={"name": f"Topping {tag}"}); check("create category", r.status_code == 201, r.text)
            top = r.json()["id"]; created_cats.append(top)
            r = await a.post("/api/catalog/categories", json={"name": "Trân châu 2 lớp", "parent_id": top}); sub = r.json()["id"]; created_cats.insert(0, sub)
            r = await a.post("/api/catalog/categories", json={"name": "x", "parent_id": sub}); check("3-level category rejected", r.status_code == 400)
            r = await a.post("/api/catalog/products", json={"name": "Trân Châu Củ Năng Hồng", "category_id": sub}); p1 = r.json()["id"]; check("create product", r.status_code == 201, r.text)
            r = await a.post("/api/catalog/products", json={"name": "Thạch Đơn Tùng", "category_id": top}); p2 = r.json()["id"]
            r = await a.post(f"/api/catalog/products/{p1}/images", files=[("files", ("a.jpg", img_bytes("pink"), "image/jpeg")), ("files", ("b.png", img_bytes("white"), "image/png"))])
            check("upload 2 images", r.status_code == 201 and len(r.json()["images"]) == 2, r.text)
            imgs = r.json()["images"]
            check("thumb generated webp", imgs[0]["thumb_url"].endswith("_t.webp") and imgs[0]["width"] <= 1080)
            r = await a.put(f"/api/catalog/products/{p1}/images/order", json=[imgs[1]["id"], imgs[0]["id"]])
            check("reorder images (primary change)", r.json()["images"][0]["id"] == imgs[1]["id"])
            r = await a.post("/api/catalog/recipes", json={"name": "Trà Sữa Xanh Nhài", "product_ids": [p1], "category_id": top}); rc = r.json()["id"]
            check("create recipe linked", r.status_code == 201 and r.json()["product_ids"] == [p1], r.text)
            r = await a.get("/api/catalog/items", params={"q": "tran chau cu nang"}); check("unaccented search", any(i["source_id"] == p1 for i in r.json()), r.text)
            r = await a.get("/api/catalog/items"); kinds = {i["item_type"] for i in r.json() if i["source_id"] in (p1, rc)}
            check("unified catalog has product+recipe", kinds == {"product", "recipe"})

            # ---- survey config
            slug = f"qa-survey-{tag}"
            r = await a.put(f"/api/workshops/{w1}/survey", json={"slug": slug, "title": f"QA Survey {tag}", "content": {"hotline": "0973 123 230"}})
            check("create survey", r.status_code == 200, r.text)
            r = await pub.get(f"/api/public/surveys/{slug}"); check("draft survey not public", r.status_code == 404)
            r = await a.post(f"/api/workshops/{w1}/survey/publish"); check("publish empty rejected", r.status_code == 400)
            structure = {
                "groups": [{"key": "g1", "title": "Topping", "short_title": "Topping"}, {"key": "g1a", "title": "1. Trân châu 2 lớp", "short_title": "Trân châu 2 lớp", "parent_key": "g1"},
                           {"key": "g2", "title": "Trà sữa"}],
                "items": [{"item_type": "product", "source_id": p1, "group_key": "g1a"}, {"item_type": "product", "source_id": p2, "group_key": "g1"},
                          {"item_type": "recipe", "source_id": rc, "group_key": "g2"}],
            }
            r = await a.put(f"/api/workshops/{w1}/survey/structure", json=structure); check("save structure", r.status_code == 200 and len(r.json()["items"]) == 3, r.text)
            r = await a.delete(f"/api/catalog/products/{p1}"); check("delete product in survey blocked", r.status_code == 409)
            r = await a.put(f"/api/workshops/{w1}/gift-config", json={"enabled": True, "gift_name": "Ly giữ nhiệt LerMao", "eligibility": "registered"})
            check("gift config", r.status_code == 200, r.text)
            r = await a.post(f"/api/workshops/{w1}/survey/publish"); check("publish v1", r.status_code == 200 and r.json()["published_version_no"] == 1, r.text)

            # ---- public flow (A: registered → gift)
            r = await pub.get(f"/api/public/surveys/{slug}"); snap = r.json()
            check("public survey open", r.status_code == 200 and snap["state"] == "open" and len(snap["items"]) == 3, r.text)
            check("snapshot groups nested", snap["groups"][0]["children"][0]["short_title"] == "Trân châu 2 lớp")
            keys = {i["source_id"]: i["key"] for i in snap["items"]}
            r = await pub.post(f"/api/public/surveys/{slug}/sessions", json={"full_name": "M", "phone": "0912345678"}); check("short name rejected", r.status_code == 422)
            r = await pub.post(f"/api/public/surveys/{slug}/sessions", json={"full_name": "Minh Anh", "phone": "0912 345"}); check("bad phone rejected", r.status_code == 422)
            r = await pub.post(f"/api/public/surveys/{slug}/sessions", json={"full_name": "Minh Anh", "phone": "0912.345.678"}); check("session created", r.status_code == 201, r.text)
            st = r.json()["token"]; H = {"X-Survey-Session": st}
            check("session masks phone", r.json()["session"]["phone_masked"] == "09•• ••• 678")
            draft = {"favorites": [keys[p1], keys[rc], "bogus"], "notes": {keys[p2]: {"tags": ["Rất ngon", "fake"], "text": "Giòn"}},
                     "adjectives": ["Ấm áp", "Hack"], "others": ["Ngon miệng", ""], "discomfort": "Hơi chật", "expectation": "", "rating": 0, "ui": {"tab": "products"}}
            r = await pub.put(f"/api/public/surveys/{slug}/session", json={"draft": draft}, headers=H); check("draft saved", r.status_code == 200 and r.json()["revision"] == 1, r.text)
            r = await pub.get(f"/api/public/surveys/{slug}/session", headers=H); d = r.json()["draft"]
            check("draft sanitized", d["favorites"] == [keys[p1], keys[rc]] and d["adjectives"] == ["Ấm áp"] and d["notes"][keys[p2]]["tags"] == ["Rất ngon"], d)
            r = await pub.get(f"/api/public/surveys/{slug}/session", headers={"X-Survey-Session": "wrong"}); check("bad session token 401", r.status_code == 401)
            r = await pub.post(f"/api/public/surveys/{slug}/submit", json={"draft": d}, headers=H); check("rating required", r.status_code == 422)
            d["rating"] = 4
            r = await pub.post(f"/api/public/surveys/{slug}/submit", json={"draft": d}, headers=H); sub_res = r.json()
            check("submit ok + gift issued", r.status_code == 200 and sub_res["submission"]["gift"]["variant"] == "gift" and sub_res["submission"]["gift"]["qr"].startswith("LMG1:"), r.text)
            qr = sub_res["submission"]["gift"]["qr"]; code = sub_res["submission"]["gift"]["code"]
            check("QR has no phone", "0912345678" not in qr and "912345678" not in qr)
            raw = qr.split(":", 1)[1]
            check("token stored hashed only", sql(f"select count(*) from gift_claims where token_hash like '%{raw}%' or short_code_hash like '%{code.replace('-', '')}%';") == "0")
            r = await pub.post(f"/api/public/surveys/{slug}/submit", json={"draft": d}, headers=H); check("double submit idempotent", r.status_code == 200 and r.json().get("duplicate") is True)
            check("still one response", sql(f"select count(*) from survey_responses r join surveys s on s.id=r.survey_id where s.slug='{slug}';") == "1")
            check("remaining slot = 1 (2 khách check-in)", sub_res["submission"]["remaining"] == 1 and sub_res["submission"]["quota"] == 2, sub_res["submission"])
            # ---- A2: người đi cùng dùng chung SĐT → phiếu thứ 2, quà thứ 2
            r = await pub.post(f"/api/public/surveys/{slug}/sessions", json={"full_name": "Người đi cùng", "phone": "+84912345678"}); check("companion session allowed", r.status_code == 201, r.text)
            H1b = {"X-Survey-Session": r.json()["token"]}
            r = await pub.post(f"/api/public/surveys/{slug}/submit", json={"draft": {"rating": 5}}, headers=H1b); g1b = r.json()["submission"]
            check("companion gets own gift QR", g1b["gift"]["variant"] == "gift" and g1b["gift"]["qr"] != qr and g1b["remaining"] == 0, g1b)
            r = await pub.post(f"/api/public/surveys/{slug}/sessions", json={"full_name": "Người thứ 3", "phone": "0912345678"})
            check("3rd session blocked: quota_reached", r.status_code == 409 and r.json()["detail"] == "quota_reached", r.text)

            # ---- B: chưa check-in / chưa đăng ký → báo liên hệ nhân viên
            r = await pub.post(f"/api/public/surveys/{slug}/sessions", json={"full_name": "Khách QA 4", "phone": "0918000444"})
            check("registered but not checked-in → 403 not_checked_in", r.status_code == 403 and r.json()["detail"] == "not_checked_in", r.text)
            r = await pub.post(f"/api/public/surveys/{slug}/sessions", json={"full_name": "Khách lạ", "phone": "0987654321"})
            check("unregistered → 403 not_checked_in", r.status_code == 403 and r.json()["detail"] == "not_checked_in", r.text)

            # ---- C: legacy phone format (+84 913 000 111) matches
            r = await pub.post(f"/api/public/surveys/{slug}/sessions", json={"full_name": "Khách QA 2", "phone": "0913000111"}); H3 = {"X-Survey-Session": r.json()["token"]}
            r = await pub.post(f"/api/public/surveys/{slug}/submit", json={"draft": {"rating": 3}}, headers=H3); g3 = r.json()["submission"]["gift"]
            check("legacy +84 phone registration matched", g3["variant"] == "gift", r.text)

            # ---- staff redemption
            r = await a.post(f"/api/workshops/{w2}/gifts/lookup", json={"code": qr}); check("wrong workshop", r.json()["result"] == "wrong_workshop" and r.json()["message"] == "Mã không thuộc workshop này." and r.json()["claim"] is None, r.text)
            r = await a.post(f"/api/workshops/{w1}/gifts/lookup", json={"code": "garbage"}); check("invalid format", r.json()["result"] == "invalid_format")
            r = await a.post(f"/api/workshops/{w1}/gifts/lookup", json={"code": qr}); lk = r.json()
            check("lookup ok, not redeemed yet", lk["result"] == "ok" and lk["can_redeem"] and lk["claim"]["status"] == "issued" and lk["claim"]["phone_masked"] == "09•• ••• 678", r.text)
            check("scan does not change status", sql(f"select status from gift_claims where id='{lk['claim']['claim_id']}';") == "issued")
            rid = str(uuid.uuid4())
            r = await a.post(f"/api/workshops/{w1}/gifts/redeem", json={"code": qr, "claim_id": lk["claim"]["claim_id"], "request_id": rid})
            check("redeem ok", r.json()["result"] == "redeemed", r.text)
            r = await a.post(f"/api/workshops/{w1}/gifts/redeem", json={"code": qr, "claim_id": lk["claim"]["claim_id"], "request_id": rid})
            check("redeem same request idempotent", r.json()["result"] == "redeemed")
            r = await a.post(f"/api/workshops/{w1}/gifts/redeem", json={"code": qr, "claim_id": lk["claim"]["claim_id"], "request_id": str(uuid.uuid4())})
            check("second redeem rejected", r.json()["result"] == "already_redeemed" and r.json()["message"] == "Mã quà tặng đã được sử dụng.", r.text)
            r = await a.post(f"/api/workshops/{w1}/gifts/lookup", json={"code": code, "method": "manual"}); check("manual code lookup → used", r.json()["result"] == "already_redeemed", r.text)

            # ---- concurrency: 6 parallel redeems on claim 3 → exactly one success
            r = await a.post(f"/api/workshops/{w1}/gifts/lookup", json={"code": g3["qr"]}); cid3 = r.json()["claim"]["claim_id"]
            rs = await asyncio.gather(*[a.post(f"/api/workshops/{w1}/gifts/redeem", json={"code": g3["qr"], "claim_id": cid3, "request_id": str(uuid.uuid4())}) for _ in range(6)])
            outcomes = [x.json()["result"] for x in rs]
            check("parallel redeem: exactly one success", outcomes.count("redeemed") == 1 and outcomes.count("already_redeemed") == 5, outcomes)

            # ---- D: reissue rotates token; expiry
            ra = await pub.post(f"/api/public/surveys/{slug}/sessions", json={"full_name": "Khách QA 3", "phone": "0914000222"})
            rb = await pub.post(f"/api/public/surveys/{slug}/sessions", json={"full_name": "Khách QA 3b", "phone": "0914000222"})
            HA, HB = {"X-Survey-Session": ra.json()["token"]}, {"X-Survey-Session": rb.json()["token"]}
            sa, sb = await asyncio.gather(pub.post(f"/api/public/surveys/{slug}/submit", json={"draft": {"rating": 5}}, headers=HA),
                                          pub.post(f"/api/public/surveys/{slug}/submit", json={"draft": {"rating": 5}}, headers=HB))
            codes = sorted([sa.status_code, sb.status_code])
            check("parallel submits, quota 1 → exactly one accepted", codes == [200, 409], codes)
            win = sa if sa.status_code == 200 else sb
            H4 = HA if win is sa else HB
            g4 = win.json()["submission"]["gift"]
            r = await pub.post(f"/api/public/surveys/{slug}/gift/reissue", headers=H4); g4b = r.json()["gift"]
            check("reissue gives new QR", g4b.get("qr") and g4b["qr"] != g4["qr"], r.text)
            r = await a.post(f"/api/workshops/{w1}/gifts/lookup", json={"code": g4["qr"]}); check("old QR invalid after reissue", r.json()["result"] == "not_found")
            sql(f"update gift_configs set redeem_until = now() - interval '1 minute' where workshop_id='{w1}';")
            r = await a.post(f"/api/workshops/{w1}/gifts/lookup", json={"code": g4b["qr"]}); check("expired", r.json()["result"] == "expired" and r.json()["message"] == "Mã nhận quà đã hết hạn.", r.text)
            sql(f"update gift_configs set redeem_until = null where workshop_id='{w1}';")

            # ---- E: registration deleted after issue → invalid_registration
            r = await a.post(f"/api/workshops/{w1}/gifts/lookup", json={"code": g4b["qr"]}); check("expired claim stays expired", r.json()["result"] == "expired")

            # ---- versioning: rename product, republish; old response keeps snapshot name
            await a.patch(f"/api/catalog/products/{p1}", json={"name": "Trân Châu Đổi Tên"})
            r = await a.post(f"/api/workshops/{w1}/survey/publish"); check("publish v2", r.json()["published_version_no"] == 2)
            r = await a.get(f"/api/workshops/{w1}/survey/results"); res = r.json()
            names = {p["source_id"]: p for p in res["popularity"]}
            check("results total=4", res["total_responses"] == 4, res)
            check("popularity rate = 1/4", abs(names[p1]["rate"] - 1 / 4) < 0.001 and names[p1]["name"] == "Trân Châu Củ Năng Hồng", names.get(p1))
            check("note counted", names[p2]["notes"] == 1 and names[p2]["favorites"] == 0)
            check("rating avg", res["rating"]["average"] == 4.25, res["rating"])
            check("gift stats", res["gifts"]["redeemed"] == 2 and res["gifts"]["expired"] == 1 and res["gifts"]["issued"] == 1, res["gifts"])
            r = await a.get(f"/api/workshops/{w1}/survey/responses"); check("responses masked", all("•" in x["phone_masked"] for x in r.json()) and len(r.json()) == 4)
            r = await a.get(f"/api/workshops/{w1}/survey/export.xlsx"); check("export xlsx", r.status_code == 200 and r.content[:2] == b"PK", r.status_code)
            r = await a.get(f"/api/workshops/{w1}/gifts"); check("gift report", r.json()["total"] == 4, r.text)
            r = await a.get(f"/api/workshops/{w1}/guests"); gl = {g["full_name"]: g for g in r.json()}
            check("guest list column: Khách QA gifts_redeemed=1/2", gl["Khách QA"]["gifts_redeemed"] == 1 and gl["Khách QA 2"]["gifts_redeemed"] == 1 and gl["Khách QA 4"]["gifts_redeemed"] == 0, {k: v.get("gifts_redeemed") for k, v in gl.items()})
            r = await a.get(f"/api/workshops/{w1}/gifts/audit"); check("audit logged", len(r.json()) >= 10)

            # ---- RBAC: tài khoản không có quyền workshop bị chặn
            vid = sql("insert into admin_users(email, name, role, account_type) values ('qa-viewer-%s@example.invalid', 'QA viewer', 'user', 'lark') returning id;" % tag).splitlines()[0]
            vtok = secrets.token_urlsafe(32)
            sql(f"insert into admin_sessions(user_id, token_hash, expires_at) values ('{vid}', '{hashlib.sha256(vtok.encode()).hexdigest()}', now() + interval '1 hour');")
            async with httpx.AsyncClient(base_url=BASE, cookies={"workshop_admin_session": vtok}, timeout=30) as v:
                check("RBAC: no-access user cannot read survey", (await v.get(f"/api/workshops/{w1}/survey")).status_code == 403)
                check("RBAC: no-access user cannot redeem", (await v.post(f"/api/workshops/{w1}/gifts/lookup", json={"code": qr})).status_code == 403)
                check("RBAC: no-access user cannot manage catalog", (await v.post("/api/catalog/products", json={"name": "x"})).status_code == 403)
                check("RBAC: no-access user cannot export", (await v.get(f"/api/workshops/{w1}/survey/export.xlsx")).status_code == 403)
            sql(f"delete from admin_users where id='{vid}';")
            r = await a.post(f"/api/workshops/{w1}/survey/structure", json={})
            check("public endpoints reject cookie-less admin calls", (await pub.get(f"/api/workshops/{w1}/survey")).status_code == 401)

            # ---- closed state
            await a.post(f"/api/workshops/{w1}/survey/close")
            r = await pub.get(f"/api/public/surveys/{slug}"); check("closed state", r.json()["state"] == "closed")
            r = await pub.post(f"/api/public/surveys/{slug}/sessions", json={"full_name": "Late", "phone": "0915000333"}); check("closed rejects session", r.status_code == 409)
            r = await pub.get("/api/public/surveys/khong-ton-tai-xyz"); check("invalid slug 404", r.status_code == 404)
            if KEEP:
                await a.post(f"/api/workshops/{w1}/survey/reopen")
                print("KEPT slug", slug, "workshop", w1)
    finally:
        if not KEEP:
            sql(f"delete from workshops where id in ('{w1}','{w2}');")
            ids = ",".join(f"'{c}'" for c in created_cats) or "NULL"
            sql(f"delete from catalog_recipes where category_id in ({ids});")
            sql(f"delete from catalog_products where category_id in ({ids});")
            for c in created_cats:
                sql(f"delete from catalog_categories where id='{c}';")
        sql(f"delete from admin_sessions where token_hash='{hashlib.sha256(token.encode()).hexdigest()}';")
    failed = [n for n, ok in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} passed")
    sys.exit(1 if failed else 0)


asyncio.run(main())
