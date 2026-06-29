"use client";
import { useEffect, useState } from "react";

const STORAGE_KEY = "ws_admin_auth";
const TTL_DAYS = 30;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;
const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "";

function isAuthed(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw) as { ok?: boolean; exp?: number };
    return !!data.ok && typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

export function adminLogout() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  window.location.reload();
}

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"checking" | "locked" | "unlocked">("checking");
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setStatus(isAuthed() ? "unlocked" : "locked");
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!ADMIN_PASSWORD) {
      setError("Chưa cấu hình mật khẩu admin (NEXT_PUBLIC_ADMIN_PASSWORD).");
      return;
    }
    if (pwd === ADMIN_PASSWORD) {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ok: true, exp: Date.now() + TTL_MS }),
        );
      } catch {
        /* ignore storage errors, vẫn cho vào phiên này */
      }
      setPwd("");
      setStatus("unlocked");
    } else {
      setError("Sai mật khẩu. Vui lòng thử lại.");
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
          onSubmit={submit}
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
            className="w-full border border-line rounded-sm px-3 py-2 text-sm mb-2"
          />
          {error && (
            <div className="text-red-600 text-xs mb-2">{error}</div>
          )}
          <button
            type="submit"
            className="w-full bg-brand text-white px-3 py-2 rounded-sm text-sm font-medium"
          >
            Đăng nhập
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}
