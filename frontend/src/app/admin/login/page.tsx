"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminLoading } from "@/contexts/AdminLoadingContext";

function safeRedirect(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return "/admin";
  try {
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid" || url.pathname === "/admin/login") return "/admin";
    return url.pathname + url.search + url.hash;
  } catch { return "/admin"; }
}

function AdminLoginForm() {
  const search = useSearchParams();
  const [submitting, setSubmitting] = useState<"lark" | "password" | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const { status, error, refresh } = useAuth();
  const { begin } = useAdminLoading();
  const redirectTo = safeRedirect(search?.get("redirect") || null);

  useEffect(() => { if (status === "authenticated") window.location.replace(redirectTo); }, [status, redirectTo]);

  const larkLogin = () => {
    if (submitting) return;
    const endPending = begin();
    setSubmitting("lark");
    window.location.assign("/api/auth/lark/login?return_to=" + encodeURIComponent(redirectTo));
    window.setTimeout(() => { endPending(); setSubmitting(null); }, 15000);
  };

  const passwordLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting("password");
    setLoginError("");
    const endPending = begin();
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(typeof payload?.detail === "string" ? payload.detail : "Không thể đăng nhập. Vui lòng kiểm tra username/email và mật khẩu.");
      }
      setPassword("");
      await refresh();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Đăng nhập thất bại. Vui lòng thử lại.");
    } finally { setSubmitting(null); endPending(); }
  };

  return <div className="bg-surface rounded-md border border-line p-6 w-full max-w-sm shadow-sm">
    <div className="mb-5">
      <div className="text-brand text-[10px] font-semibold tracking-widest leading-none">HI SWEETIE VIỆT NAM</div>
      <h1 className="text-brand-teal font-bold text-lg leading-tight mt-1">Đăng nhập quản trị</h1>
      <p className="text-muted text-xs mt-2">Dùng tài khoản Lark hoặc email (tài khoản riêng), username (khách check-in) và mật khẩu được cấp.</p>
    </div>
    {(loginError || error || search?.get("error")) && <div role="alert" className="text-red-700 bg-red-50 rounded-sm p-3 text-sm mb-4">{loginError || error || "Đăng nhập thất bại. Vui lòng thử lại hoặc liên hệ quản trị viên."}</div>}
    <form onSubmit={passwordLogin} className="space-y-4">
      <label htmlFor="login-identifier" className="block text-sm font-medium text-brand-teal">Email hoặc username
        <input id="login-identifier" type="text" required autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} value={identifier} onChange={(event) => setIdentifier(event.target.value)} disabled={Boolean(submitting)} className="mt-1 min-h-11 w-full border border-line bg-white rounded-sm px-3 py-2 text-sm text-ink" />
      </label>
      <label htmlFor="login-password" className="block text-sm font-medium text-brand-teal">Mật khẩu
        <input id="login-password" type="password" required maxLength={128} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={Boolean(submitting)} className="mt-1 min-h-11 w-full border border-line bg-white rounded-sm px-3 py-2 text-sm text-ink" />
      </label>
      <button type="submit" disabled={Boolean(submitting) || status === "loading"} className="min-h-11 w-full bg-brand text-brand-teal px-3 py-2 rounded-sm text-sm font-semibold disabled:opacity-60">{submitting === "password" ? "Đang đăng nhập…" : "Đăng nhập bằng mật khẩu"}</button>
    </form>
    <p className="mt-3 text-xs text-muted">Tài khoản khách check-in chỉ đăng nhập được trong khoảng thời gian đã cấp. Liên hệ quản trị viên nếu cần đặt lại mật khẩu.</p>
    <div className="my-4 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />hoặc<span className="h-px flex-1 bg-line" /></div>
    <button type="button" onClick={larkLogin} disabled={Boolean(submitting) || status === "loading"} className="min-h-11 w-full border border-line text-brand-teal px-3 py-2 rounded-sm text-sm font-semibold disabled:opacity-60">{submitting === "lark" ? "Đang chuyển đến Lark…" : "Đăng nhập bằng Lark"}</button>
  </div>;
}

export default function AdminLoginPage() {
  return <div className="min-h-[calc(100vh-64px)] flex items-center justify-center p-4"><Suspense fallback={<div className="p-6 text-center text-muted text-sm">Đang tải…</div>}><AdminLoginForm /></Suspense></div>;
}
