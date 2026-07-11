/** Options mô hình kinh doanh — dùng chung form đăng ký, admin, thống kê. */
export const BUSINESS_MODEL_OPTIONS = [
  "Đang kinh doanh cà phê / trà sữa",
  "Cung cấp dịch vụ đào tạo, setup quán",
  "Công ty / Hộ kinh doanh cung cấp nguyên liệu",
  "Đang chuẩn bị mở quán",
  "Đối tác hợp tác thương hiệu",
  "Khác",
] as const;

export type BusinessModelOption = (typeof BUSINESS_MODEL_OPTIONS)[number];

/** 5 giá trị chuẩn; mọi giá trị khác (kể cả rỗng) thuộc nhóm filter "Khác". */
export const BUSINESS_MODEL_KNOWN = BUSINESS_MODEL_OPTIONS.filter((o) => o !== "Khác");
