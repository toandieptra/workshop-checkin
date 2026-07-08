"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const CSRF_HEADER = "x-admin-session";

type Status = "checking" | "locked" | "unlocked";

async function checkMe(): Promise<boolean> {
  try {
    const res = await fetch("/api/admin/me", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function adminLogout(): Promise<void> {
  try {
    await fetch("/api/admin/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { [CSRF_HEADER]: "1" },
    });
  } catch {
    /* ignore */
  }
  window.location.href = "/admin/login";
}

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    checkMe().then((ok) => {
      if (cancelled) return;
      setStatus(ok ? "unlocked" : "locked");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pwd }),
      });
      if (res.ok) {
        setPwd("");
        setStatus("unlocked");
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
        setError("Admin chưa được cấu hình (thiếu ADMIN_PASSWORD / ADMIN_SESSION_SECRET).");
        return;
      }
      setError("Sai mật khẩu. Vui lòng thử lại.");
    } catch {
      setError("Lỗi mạng. Vui lòng thử lại.");
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-muted">
        <div className="text-muted text-sm">Đang kiểm tra…</div>
      </div>
    );
  }

  if (status === "locked") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-muted p-4">
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
      </div>
    );
  }

  return <>{children}</>;
}