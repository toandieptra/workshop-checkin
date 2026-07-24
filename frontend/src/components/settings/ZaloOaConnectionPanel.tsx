"use client";

import { useCallback, useEffect, useState } from "react";
import { getZbsOAuthStatus, refreshZbsOAuth, testZbsOAuth } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";
import type { ZbsOAuthStatusResponse } from "@/types/zbs-template";

const STATUS_META = {
  connected: { label: "Đã kết nối", className: "bg-green-50 text-green-700" },
  expiring: { label: "Sắp hết hạn", className: "bg-amber-50 text-amber-700" },
  refresh_failed: { label: "Làm mới thất bại", className: "bg-amber-50 text-amber-700" },
  reauthorization_required: { label: "Cần kết nối lại", className: "bg-red-50 text-red-700" },
  not_configured: { label: "Chưa cấu hình", className: "bg-gray-100 text-gray-600" },
};

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}

export default function ZaloOaConnectionPanel() {
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.connectionsManage) && can(PERMISSIONS.zbsManage);
  const [status, setStatus] = useState<ZbsOAuthStatusResponse | null>(null);
  const [action, setAction] = useState<"load" | "test" | "refresh" | null>("load");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setAction("load");
    setError("");
    try { setStatus(await getZbsOAuthStatus()); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Không tải được trạng thái Zalo OA."); }
    finally { setAction(null); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (nextAction: "test" | "refresh") => {
    setAction(nextAction);
    setMessage("");
    setError("");
    try {
      setStatus(nextAction === "test" ? await testZbsOAuth() : await refreshZbsOAuth());
      setMessage(nextAction === "test" ? "Kết nối Zalo OA đang hoạt động." : "Đã làm mới Access Token.");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Thao tác thất bại.");
      try { setStatus(await getZbsOAuthStatus()); } catch {}
    } finally { setAction(null); }
  };

  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-lg font-bold text-ink">Zalo Official Account</h2>
            {status && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_META[status.status].className}`}>{STATUS_META[status.status].label}</span>}
          </div>
          <p className="mt-1 text-sm text-muted">Kết nối chính thức dùng để gửi ZBS và đồng bộ mẫu tin.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void load()} disabled={!!action} className="min-h-10 rounded-md border border-line px-4 text-sm font-semibold disabled:opacity-50">Làm mới</button>
          {canManage && <button type="button" onClick={() => void run("test")} disabled={!!action} className="min-h-10 rounded-md border border-brand px-4 text-sm font-semibold text-brand-teal disabled:opacity-50">{action === "test" ? "Đang kiểm tra..." : "Kiểm tra kết nối"}</button>}
          {canManage && <button type="button" onClick={() => void run("refresh")} disabled={!!action || status?.status === "not_configured"} className="min-h-10 rounded-md bg-brand px-4 text-sm font-semibold text-brand-teal disabled:opacity-50">{action === "refresh" ? "Đang làm mới..." : "Làm mới token"}</button>}
        </div>
      </div>
      {action === "load" && !status ? <div className="mt-5 h-20 animate-pulse rounded-md bg-surface-muted" /> : status && <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-md bg-surface-muted p-3"><div className="text-xs font-semibold uppercase tracking-wide text-muted">Access Token hết hạn</div><div className="mt-1 font-medium text-ink">{formatDateTime(status.access_token_expires_at)}</div></div>
        <div className="rounded-md bg-surface-muted p-3"><div className="text-xs font-semibold uppercase tracking-wide text-muted">Làm mới gần nhất</div><div className="mt-1 font-medium text-ink">{formatDateTime(status.last_refreshed_at)}</div></div>
        <div className="rounded-md bg-surface-muted p-3"><div className="text-xs font-semibold uppercase tracking-wide text-muted">Refresh Token</div><div className="mt-1 font-medium text-ink">{status.configured ? "Đã cấu hình" : "Chưa cấu hình"}</div></div>
      </div>}
      {message && <div className="mt-3 rounded-md border border-success-border bg-success-soft p-3 text-sm text-success">{message}</div>}
      {(error || status?.last_refresh_error) && <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-error">{error || status?.last_refresh_error}</div>}
    </section>
  );
}
