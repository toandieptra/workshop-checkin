"use client";

import { useAuth } from "@/contexts/AuthContext";

export default function GuestAccessNotice() {
  const { user } = useAuth();
  if (user?.account_type !== "checkin_guest") return null;
  const expiry = new Date(user.access_expires_at || "");
  const expiryText = Number.isNaN(expiry.getTime()) ? "—" : expiry.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
  return <aside className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:px-6" aria-label="Thời hạn tài khoản khách">
    <strong>Tài khoản khách check-in</strong>
    <span className="mt-1 block sm:ml-2 sm:mt-0 sm:inline">Xem danh sách, thêm khách mới và check-in tại workshop được cấp. Quyền truy cập kết thúc lúc {expiryText} (giờ thiết bị).</span>
  </aside>;
}
