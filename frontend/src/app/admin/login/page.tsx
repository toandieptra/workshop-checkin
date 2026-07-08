"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function AdminLoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const redirectTo = search?.get("redirect") || "/admin";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password: pwd }),
      });
      if (res.ok) {
        router.replace(redirectTo);
        router.refresh();
        return;
      }
      if (res.status === 429) {
        const ra = res.headers.get("retry-after");
        const seconds = ra ? Number(ra) : NaN;
        const pretty = Number.isFinite(seconds) ? ` sau ${seconds} giây` : " sau ít phút";
        setError(`Quá nhiều lần thử. Vui lòng thử lại${pretty}.`);
        return;
      }
      if (res.status === 500) {
        setError("Admin chưa được cấu hình. Liên hệ người quản trị hệ thống.");
        return;
      }
      setError("Sai mật khẩu. Vui lòng thử lại.");
    } catch {
      setError("Lỗi mạng. Vui lòng thử lại.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
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
          Nhập mật khẩu để vào khu quản trị (Khách mời &amp; Thống kê).
        </p>
      </div>
      <input
        type="password"
        autoFocus
        value={pwd}
        onChange={(e) => setPwd(e.target.value)}
        placeholder="Mật khẩu"
        disabled={submitting}
        className="w-full border border-line rounded-sm px-3 py-2 text-sm mb-2 disabled:opacity-60"
      />
      {error && <div className="text-red-600 text-xs mb-2">{error}</div>}
      <button
        type="submit"
        disabled={submitting || pwd.length === 0}
        className="w-full bg-brand text-white px-3 py-2 rounded-sm text-sm font-medium disabled:opacity-60"
      >
        {submitting ? "Đang đăng nhập…" : "Đăng nhập"}
      </button>
    </form>
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