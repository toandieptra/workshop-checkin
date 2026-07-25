import type { ZaloMessageQuota, ZaloMessageTemplateStatus } from "@/types/zalo-message";

export const PAGE_SIZE = 20;
export const MAX_MEDIA_COUNT = 10;
export const MAX_MEDIA_FILE_SIZE = 50 * 1024 * 1024;

export const EMPTY_QUOTA: ZaloMessageQuota = {
  used: 0,
  limit: 0,
  remaining: 0,
  resets_at: null,
};

export const STATUS_OPTIONS: Array<{
  value: ZaloMessageTemplateStatus | "";
  label: string;
}> = [
  { value: "", label: "Tất cả trạng thái" },
  { value: "active", label: "Đang sử dụng" },
  { value: "draft", label: "Bản nháp" },
  { value: "archived", label: "Đã lưu trữ" },
];

export const STATUS_META: Record<
  ZaloMessageTemplateStatus,
  { label: string; className: string }
> = {
  active: { label: "Đang sử dụng", className: "bg-green-50 text-green-700" },
  draft: { label: "Bản nháp", className: "bg-amber-50 text-amber-700" },
  archived: { label: "Đã lưu trữ", className: "bg-gray-100 text-gray-600" },
};
