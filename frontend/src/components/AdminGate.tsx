"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PERMISSIONS } from "@/lib/permissions";
import { useAuth } from "@/contexts/AuthContext";

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const { user, status, error, can, canInAnyWorkshop } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const fallback = canInAnyWorkshop(PERMISSIONS.workshopsView) || can(PERMISSIONS.workshopsCreate) ? "/admin/workshop"
    : canInAnyWorkshop(PERMISSIONS.formsView) ? "/admin/forms"
    : canInAnyWorkshop(PERMISSIONS.reportsView) ? "/admin/thong-ke"
    : [PERMISSIONS.usersManage, PERMISSIONS.connectionsView, PERMISSIONS.zbsView, PERMISSIONS.zaloTemplatesView].some(can) ? "/admin/cai-dat"
    : null;
  const redirect = status === "authenticated" && (user?.account_type === "checkin_guest" && pathname !== "/admin" ? "/admin" : pathname === "/admin" && !canInAnyWorkshop(PERMISSIONS.guestsView) && fallback);
  useEffect(() => { if (redirect) router.replace(redirect); }, [redirect, router]);
  if (redirect) return <div className="min-h-[60vh] flex items-center justify-center text-sm text-muted">Đang mở trang quản trị…</div>;

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-muted">
        <div className="text-muted text-sm">Đang kiểm tra…</div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-sm text-muted">Đang chuyển đến trang đăng nhập…{error ? ` (${error})` : ""}</div>
    );
  }

  if (status === "forbidden") return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="max-w-md bg-surface border border-line rounded-md p-6 text-center">
        <div className="text-4xl mb-3">403</div><h1 className="text-xl font-bold text-brand-teal">Không có quyền truy cập</h1>
        <p className="text-sm text-muted mt-2">Tài khoản của bạn chưa được cấp quyền vào khu vực quản trị.</p>
      </div>
    </div>
  );

  return <>{children}</>;
}
