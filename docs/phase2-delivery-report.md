# PHASE 2 — Báo cáo bàn giao (local, chưa commit/deploy)

Ngày: 2026-11-12 · Discovery: `docs/phase2-survey-discovery.md`

## Đã làm và đã kiểm thử
| Hạng mục | Kiểm chứng |
|---|---|
| Migration `045_survey_catalog_gifts.sql`: chỉ **thêm** bảng/index/quyền, không sửa/xoá dữ liệu cũ, replay an toàn. Quyền role dựng sẵn được cấp **một lần** (marker), deploy lại không cấp lại quyền đã gỡ tay | Chạy 3 lần trên DB local, không lỗi |
| Catalog dùng chung: danh mục 2 cấp, sản phẩm, công thức liên kết sản phẩm, tối đa 12 ảnh/mục (WebP thumb 480 + gallery 1080), sắp xếp, ảnh chính, khung cắt dọc, trạng thái active/inactive/archived, chặn xoá mục đang trong khảo sát | E2E + giao diện `/admin/san-pham` |
| Catalog hợp nhất `SurveyCatalogItem` (`GET /api/catalog/items`) — không nhân bản dữ liệu | E2E |
| Cấu hình khảo sát theo workshop: slug, tiêu đề, giờ mở/đóng, nội dung, ảnh bìa, bật/tắt từng câu hỏi, tính từ, tag nhận xét, cây nhóm 2 cấp, chọn món, tên/ảnh riêng, xuất bản tạo **phiên bản snapshot**, đóng/mở lại | E2E + `/admin/khao-sat` |
| Public survey `/survey/[slug]` theo artifact thiết kế: 00 Nhận diện + validation, Resume, 4 tab, tìm không dấu, tab nhóm + chip phân nhóm, tim 1 chạm, Gallery (vuốt/phím/back), sheet nhận xét món, Đã thích + Hoàn tác, Góp ý 02–04, Hoàn tất + bắt buộc sao, Cảm ơn, Closed/Not-open, Invalid | Trình duyệt 390px, so từng màn với artboard |
| Nháp lưu máy chủ (session token hash, header, không trong URL) + bản sao cục bộ; pill chỉ báo “Đã lưu” khi máy chủ xác nhận | Trình duyệt (reload → Resume đúng) |
| Responsive 2/3/4/5 cột ở 390/480/834/1280px, desktop nav lên trên, không bị zoom 0.9 của admin | Đo computed style trong iframe |
| Quà & khảo sát chỉ cho SĐT **đã check-in** (chưa check-in → báo khách liên hệ nhân viên). Mỗi SĐT gửi tối đa số phiếu = số khách đã check-in; mỗi phiếu = 1 mã QR = 1 quà khi nhân viên quét hợp lệ và xác nhận (kiểm tra quota trong giao dịch có khoá). Cột **Quà tặng** ở `/admin` hiển thị đã trao / số khách check-in. Ngoài ra: token ngẫu nhiên chỉ lưu SHA-256, QR không chứa SĐT, mã nhập tay, cấp lại mã (mã cũ vô hiệu), hết hạn, thu hồi | E2E |
| Trao quà ngay trong trang Khách mời `/admin` (nút “Trao quà” theo workshop đang chọn, mở dialog): camera + mã tay, quét chỉ tra cứu, nút “Xác nhận đã trao quà”, khoá hàng `FOR UPDATE`, idempotent theo `request_id`, audit mọi lần tra cứu/trao | E2E (6 lệnh trao song song → đúng 1 thành công) + trình duyệt |
| Thông điệp đúng spec: “Mã quà tặng đã được sử dụng.”, “Mã nhận quà đã hết hạn.”, “Mã không thuộc workshop này.” | E2E + trình duyệt |
| Kết quả: tổng quan, phân bố sao, độ phổ biến món (tỷ lệ = phiếu chọn ÷ phiếu hợp lệ, gộp theo nguồn qua các phiên bản), tính từ, góp ý, nhận xét món, danh sách phiếu (SĐT che), lọc, loại phiếu khỏi thống kê (không xoá), xuất Excel, báo cáo quà | E2E + trình duyệt |
| RBAC: quyền mới `catalog.*`, `surveys.*`, `gifts.*` theo workshop; user không có quyền bị 403 | E2E |
| Rate limit Redis cho endpoint public (IP rộng vì cả hội trường chung IP; chặt theo SĐT/phiên) | Code review; chưa test tải |

Kết quả chạy: `pytest` 250 passed / 3 skipped; `backend/tests/e2e_survey_smoke.py` 71/71; `tsc` sạch; `next build` thành công.

## Làm một phần / khác thiết kế (có chủ đích)
- **Màn Cảm ơn**: thiết kế dùng “chụp màn hình + mã LM-XXXX”; spec yêu cầu QR quà ⇒ giữ bố cục thẻ viền đứt crimson, thay bằng QR + mã nhập tay; thêm biến thể “không đủ điều kiện”.
- Trạng thái claim `eligible` có trong schema nhưng không dùng (claim phát hành thẳng `issued` khi gửi phiếu).
- Chưa có thanh “Xong” khi bàn phím mở (S03) — hiện chỉ ẩn bottom nav; chưa có chạm đúp phóng to ảnh trong Gallery.
- Responsive tablet/desktop của survey mới kiểm chứng bằng số đo, chưa chụp màn hình (pane trình duyệt liên tục đổi kích thước).

## Chưa làm / bị chặn
- Chưa nhập 64 món + ảnh từ thiết kế vào catalog — cần anh/chị xác nhận danh sách và 5 ảnh nghi vấn (Handoff mục 1). Có thể làm bằng script import khi đồng ý.
- Chưa commit, chưa deploy NAS.
- Tài khoản khách check-in (nhân viên quầy) chưa có `gifts.redeem`.

## Dữ liệu QA trên DB local
Workshop `[QA] Workshop Chuyển LerMao x Sri/Mar` (slug `qa-demo-lermao`), 4 danh mục `[QA] …`, 6 món, 1 phiếu đã nhận quà — để xem thử; có thể xoá bất kỳ lúc nào.
