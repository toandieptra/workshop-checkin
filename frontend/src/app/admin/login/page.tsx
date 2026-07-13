"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

function AdminLoginForm() {
  const search = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const { status, error } = useAuth();

  const redirectTo = search?.get("redirect") || "/admin";

  useEffect(() => {
    if (status === "authenticated") window.location.replace(redirectTo);
  }, [status, redirectTo]);

  const login = () => {
    setSubmitting(true);
    window.location.assign(`/api/auth/lark/login?return_to=${encodeURIComponent(redirectTo)}`);
  };

  return (
    <div
      className="bg-surface rounded-md border border-line p-6 w-full max-w-sm shadow-sm"
    >
      <div className="mb-4">
        <div className="text-brand text-[10px] font-semibold tracking-widest leading-none">
          HI SWEETIE VIỆT NAM
        </div>
        <h1 className="text-brand-teal font-bold text-lg leading-tight mt-1">
          Đăng nhập quản trị
        </h1>
        <p className="text-muted text-xs mt-1">
          Sử dụng tài khoản Lark đã được cấp quyền để tiếp tục.
        </p>
      </div>
      {(error || search?.get("error")) && <div className="text-red-600 text-xs mb-3">Đăng nhập thất bại. Vui lòng thử lại hoặc liên hệ quản trị viên.</div>}
      <button
        type="button"
        onClick={login}
        disabled={submitting || status === "loading"}
        className="w-full bg-brand text-white px-3 py-2 rounded-sm text-sm font-medium disabled:opacity-60"
      >
        {submitting ? "Đang chuyển đến Lark…" : "Đăng nhập bằng Lark"}
      </button>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="bg-surface rounded-md border border-line p-6 w-full max-w-sm shadow-sm text-center text-muted text-sm">
            Đang tải…
          </div>
        }
      >
        <AdminLoginForm />
      </Suspense>
    </div>
  );
}
