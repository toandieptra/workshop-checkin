# PHASE 2 — Discovery Deliverable: Survey, Product Catalog & Gift Redemption

Ngày audit: 2026-11-12. Nguồn thiết kế: artifact Design `8e734734-…` (28 artboard, đã đọc toàn bộ:
UX-Architecture, Main prototype, S00–S05, State-Closed/Invalid, QR-Preview, Responsive-Tablet,
Components, Tokens, Handoff, tokens.css của DS LerMao).

## 1. Kiến trúc hiện tại

| Lớp | Hiện trạng |
|---|---|
| Backend | FastAPI + SQLAlchemy async (asyncpg) + Postgres 16 + Redis. Router theo domain trong `backend/app/routers/`, model gộp trong `backend/app/models.py`, schema Pydantic trong `schemas.py` / `schemas_public.py`. |
| Migration | SQL thuần `migrations/NNN_*.sql`, liệt kê từng file trong `deploy-nas.sh` / `deploy.sh`, chạy lại mỗi lần deploy ⇒ bắt buộc idempotent. Mới nhất: `044`. |
| Auth/RBAC | Session cookie, `current_user`, `require_permission` (quyền toàn cục), `require_workshop_permission` (quyền theo workshop: membership + `all_workshops_role`, admin/super_admin bỏ qua membership), `allowed_workshop_ids`. Quyền lưu trong `role_permissions` (DB) ⇒ quyền mới phải được thêm bằng migration cho role dựng sẵn. Tài khoản `checkin_guest` có bộ quyền cố định. |
| Frontend | Next.js 14 app router, Tailwind theo DS **Diệp Trà** (admin). Gọi API qua path tương đối, Next rewrite sang backend; nginx route `/public/*` thẳng vào backend `/api/public/*` (giữ IP thật cho rate limit). `body{zoom:.9}` trên desktop. |
| Upload | Ghi file vào `UPLOAD_DIR` (`/uploads/...`), phục vụ tĩnh qua nginx; kiểm tra MIME/đuôi, giới hạn 10 MB. Không có xử lý ảnh (không Pillow). |
| Test | `backend/.venv/bin/python -m pytest` — 241 passed, 3 skipped (baseline). Frontend chưa có test runner; kiểm tra bằng `tsc` + build + trình duyệt. |

## 2. Module tái sử dụng

- **Workshop** (`workshops`): khóa ngoại cho survey, gift, quyền workshop.
- **Guest = đăng ký workshop** (`guests`: `workshop_id`, `phone` đã chuẩn hóa, `registration_status`, `checkin_status`, `deleted_at`) ⇒ nguồn xác thực điều kiện nhận quà. Không tạo bảng đăng ký mới.
- `normalize_phone` / chuẩn hóa SĐT (`services/zbs.py`, `registration_forms._normalize_phone`) ⇒ một hàm dùng chung cho survey + gift.
- RBAC theo workshop (`require_workshop_permission`, `allowed_workshop_ids`, `useAuth().canForWorkshop`).
- Rate limit Redis (mẫu `check_login_rate_limit`, Lua script) ⇒ tổng quát hóa cho endpoint public.
- Upload file (mẫu `upload_workshop_media`, `_delete_media_file`).
- Quét QR: `html5-qrcode` + mẫu `GuestQrScanner` (camera → confirm → success/error); `react-qr-code` để vẽ QR.
- Xuất Excel: `openpyxl` (đã có ở import/export).
- Admin shell: `AdminNav`, `Can`, `WorkshopPicker`, dialog focus hook, `admin-table-scroll`.

## 3. Module mới

1. **Catalog** (toàn hệ thống, dùng chung mọi workshop): danh mục 2 cấp, sản phẩm (nhiều ảnh, thứ tự, ảnh chính), công thức (liên kết sản phẩm, nhiều ảnh). Bảng hợp nhất ảo `SurveyCatalogItem {item_type: product|recipe, source_id}` — không nhân bản dữ liệu.
2. **Survey config theo workshop**: tiêu đề, trạng thái draft/published/closed, slug public, giờ mở/đóng, nội dung hero/brand line/tagline/lời chào, liên hệ, danh sách tính từ, tag nhận xét món, nhóm hiển thị/phân nhóm + thứ tự, chọn sản phẩm/công thức, ảnh override, bật/tắt câu hỏi, cấu hình quà. **Version snapshot** khi publish.
3. **Public survey** `/survey/[slug]`: theo đúng prototype (00 Nhận diện, Resume, 4 tab Sản phẩm/Đã thích/Góp ý/Hoàn tất, Gallery, sheet nhận xét món, snackbar hoàn tác, Cảm ơn, Closed, Invalid), session token bảo mật, nháp lưu máy chủ + bộ nhớ cục bộ.
4. **Gift redemption**: claim per (workshop, registration), token ngẫu nhiên lưu dạng hash, trang quét QR cho nhân viên, nhập mã tay, xác nhận 2 bước, redeem nguyên tử + idempotent, nhật ký audit.
5. **Results & Reporting**: tổng quan, phân bố sao, độ phổ biến món, tính từ, góp ý, danh sách phản hồi (SĐT che), lọc, xuất Excel, báo cáo quà.

## 4. Thay đổi schema (migration `045_survey_catalog_gifts.sql`, chỉ ADD — không sửa/xóa dữ liệu cũ)

- `catalog_categories(id, parent_id→self, name, slug, sort_order, is_active, …)`
- `catalog_products(id, category_id, name, search_key, description, status active|inactive|archived, sort_order, …)`
- `catalog_product_images(id, product_id, file_url, thumb_url, alt, sort_order, is_primary…)`
- `catalog_recipes(id, category_id, name, search_key, description, status, …)` + `catalog_recipe_images` + `catalog_recipe_products(recipe_id, product_id)`
- `surveys(id, workshop_id UNIQUE, slug UNIQUE, title, status, opens_at, closes_at, content JSONB, settings JSONB, current_version_id, …)`
- `survey_groups(id, survey_id, parent_id, title, short_title, sort_order)`
- `survey_items(id, survey_id, group_id, item_type, product_id|recipe_id, display_name, image_override_url, sort_order)` — CHECK đúng 1 nguồn, UNIQUE (survey, nguồn).
- `survey_versions(id, survey_id, version_no, snapshot JSONB, published_at, published_by)`
- `survey_sessions(id, survey_id, token_hash UNIQUE, full_name, phone, draft JSONB, status draft|submitted, version_id, …)`
- `survey_responses(id, survey_id, version_id, session_id UNIQUE, full_name, phone, guest_id, rating, adjectives JSONB, discomfort, expectation, submitted_at, …)` + UNIQUE (survey_id, phone)
- `survey_response_items(response_id, survey_item_id, item_type, source_id, name_snapshot, favorited, note_tags, note_text)`
- `gift_configs(workshop_id PK, enabled, gift_name, description, eligibility, expires_at, …)`
- `gift_claims(id, workshop_id, response_id UNIQUE, guest_id, status eligible|issued|redeemed|expired|revoked, token_hash UNIQUE, short_code_hash, issued_at, redeemed_at, redeemed_by, …)` + UNIQUE (workshop_id, guest_id)
- `gift_audit_logs(id, claim_id, workshop_id, action, actor_user_id, result, detail JSONB, created_at)`
- Quyền mới: `catalog.read`, `catalog.manage`, `surveys.read`, `surveys.manage`, `gifts.redeem`, `gifts.manage` — thêm vào `role_permissions` của role dựng sẵn (UPDATE có điều kiện, idempotent).

## 5. Route / API

Admin (cookie + RBAC):
- `GET/POST/PATCH/DELETE /api/catalog/categories|products|recipes` (+ `/images` upload, reorder, set primary). Quyền toàn cục `catalog.*`.
- `GET /api/catalog/items?q=&type=&category=` — catalog hợp nhất cho bộ chọn.
- `GET/PUT /api/workshops/{id}/survey`, `POST …/survey/publish|close|reopen`, `PUT …/survey/items`, `PUT …/survey/groups`, `GET/PUT …/gift-config` — quyền workshop `surveys.*` / `gifts.manage`.
- `GET …/survey/results`, `GET …/survey/responses`, `GET …/survey/export.xlsx`, `GET …/gifts/report`.
- `POST /api/gifts/lookup` (token hoặc mã tay → thông tin claim, KHÔNG đổi trạng thái), `POST /api/gifts/{claim_id}/redeem` (xác nhận, khóa hàng, idempotency key) — quyền workshop `gifts.redeem`.

Public (không cookie, rate limit Redis theo IP + SĐT):
- `GET /api/public/surveys/{slug}` — cấu hình đã publish + catalog snapshot.
- `POST /api/public/surveys/{slug}/sessions` — tạo phiên (tên + SĐT) → session token (chỉ trả 1 lần).
- `GET/PUT /api/public/surveys/{slug}/session` (header `X-Survey-Session`) — lấy/lưu nháp.
- `POST /api/public/surveys/{slug}/submit` — gửi, xác định điều kiện quà, phát hành claim.
- `POST /api/public/surveys/{slug}/gift/reissue` — cấp lại QR cho đúng phiên (xoay token cũ).

Frontend:
- `/survey/[slug]` (public), `/admin/san-pham` (catalog), `/admin/workshop/[id]/khao-sat` (cấu hình + QR preview + kết quả), `/admin/qua-tang` (quét QR nhận quà).

## 6. Phụ thuộc

- Backend: thêm **Pillow** (tạo thumbnail WebP cho thẻ sản phẩm theo spec ảnh của Handoff: thumb ≤ ~45 KB, full ≤ 1080 px).
- Frontend: không thêm thư viện; dùng `react-qr-code`, `html5-qrcode` sẵn có; font Montserrat qua `next/font/google` (subset vietnamese), SVN Cookies + logo/mascot lấy từ DS LerMao trong artifact → `public/`.

## 7. Rủi ro tương thích

- `role_permissions` lưu trong DB: thiếu migration ⇒ role editor/admin không thấy tính năng. Đã xử lý bằng UPDATE idempotent.
- Deploy replay migration: dùng `CREATE TABLE IF NOT EXISTS`, `DO $$` cho constraint.
- Backend khởi động trước migration (sự cố 502 trước đây): deploy script đã có `restart backend` sau migration.
- `body{zoom:.9}` + DS Diệp Trà của admin ⇒ trang survey cần scope token LerMao riêng và tắt zoom cho route này.
- Không đụng hợp đồng API cũ; chỉ thêm route mới. Không xóa/sửa dữ liệu hiện có.
- Pillow trong image backend (python slim) — có wheel, nhưng build image sẽ lâu hơn một chút.

## 8. Giả định nghiệp vụ CHƯA xác minh (đang dùng mặc định, có thể đổi trong cấu hình)

1. Canvas thiết kế vẫn ghi “CHỜ DUYỆT (vòng 2)” và stop-gate “APPROVED DESIGN — PROCEED TO IMPLEMENT”; coi yêu cầu PHASE 2 của anh/chị là xác nhận duyệt.
2. Thiết kế màn Cảm ơn dùng “Chụp màn hình + mã LM-XXXX”; spec yêu cầu QR quà ⇒ giữ nguyên bố cục thẻ viền đứt crimson, thay nội dung bằng QR + mã nhập tay (biến thể “có quà”), và biến thể “không quà” bỏ thẻ này.
3. Thiết kế chỉ lưu nháp cục bộ; spec yêu cầu session bảo mật ⇒ lưu cả máy chủ + cục bộ; pill chỉ báo “Đã lưu” khi máy chủ xác nhận, “Chưa lưu được” khi lỗi (trung thực).
4. Điều kiện quà mặc định = có đăng ký (guest chưa xóa) cùng workshop, khớp SĐT chuẩn hóa; không yêu cầu đã check-in / đã xác nhận (chọn được `registered | confirmed | checked_in` trong cấu hình quà).
5. (Đã thay bằng mục 4.)
6. Danh mục 2 cấp (vd Topping → 4 phân nhóm). Công thức hiển thị như thẻ món trong survey.
7. Catalog chưa có dữ liệu trong hệ thống này (không tìm thấy module sản phẩm; KiotViet/khác chưa tích hợp). 64 món + ảnh trong thiết kế chỉ là dữ liệu tham khảo, không tự seed vào production — có thể nhập bằng công cụ import khi anh/chị xác nhận danh sách & 5 ảnh đang nghi vấn (Handoff mục 1).
8. Tài khoản khách check-in (nhân viên quầy) chưa được cấp `gifts.redeem` mặc định.
9. Tự đóng phiếu: theo `closes_at` cấu hình; không có giá trị mặc định ngầm.
10. Không có checkbox đồng ý dữ liệu (giữ dòng giải thích như thiết kế) — câu hỏi 9 trong Handoff còn mở.
