export const GUEST_SOURCE_OPTIONS = [
  "Đại lý giới thiệu",
  "Bài viết trên Mạng xã hội Facebook, Zalo, Tiktok",
  "Thông tin trên hội nhóm Facebook, Zalo",
  "Quảng cáo trên Facebook, Zalo, Tiktok",
  "Khác",
] as const;

export type GuestSource = (typeof GUEST_SOURCE_OPTIONS)[number];
