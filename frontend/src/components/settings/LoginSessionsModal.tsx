"use client";

import { useEffect, useRef } from "react";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import type { ManagedAccount } from "@/components/settings/AccountManagementModal";

type ManagedUser = ManagedAccount;

export interface AdminSession {
  id: string;
  user_id: string;
  user_agent?: string | null;
  ip_address?: string | null;
  created_at?: string | null;
  last_seen_at?: string | null;
  expires_at?: string | null;
  is_current: boolean;
  is_active: boolean;
  status: "active" | "expired";
}

interface LoginSessionsModalProps {
  user: ManagedUser;
  sessions: AdminSession[];
  loading: boolean;
  error: string;
  actionId: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onRevoke: (session: AdminSession) => void;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}

function deviceLabel(userAgent?: string | null): string {
  if (!userAgent) return "Thiết bị không xác định";
  const browser = userAgent.includes("Electron/") ? "Ứng dụng máy tính"
    : userAgent.includes("Edg/") ? "Microsoft Edge"
    : userAgent.includes("OPR/") ? "Opera"
      : userAgent.includes("Chrome/") ? "Google Chrome"
        : userAgent.includes("Firefox/") ? "Firefox"
          : userAgent.includes("Safari/") && !userAgent.includes("Chrome/") ? "Safari"
            : "Trình duyệt khác";
  const os = userAgent.includes("iPhone") || userAgent.includes("iPad") ? "iOS"
    : userAgent.includes("Windows") ? "Windows"
      : userAgent.includes("Mac OS X") ? "macOS"
      : userAgent.includes("Android") ? "Android"
        : userAgent.includes("Linux") ? "Linux"
          : "Hệ điều hành khác";
  return `${browser} · ${os}`;
}

export function LoginSessionsModal({ user, sessions, loading, error, actionId, onClose, onRefresh, onRevoke }: LoginSessionsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, dialogRef);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !actionId) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [actionId, onClose]);

  const activeCount = sessions.filter((session) => session.is_active).length;

  return <div
    className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
    onClick={() => !actionId && onClose()}
    role="dialog"
    aria-modal="true"
    aria-labelledby="login-sessions-title"
  >
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-xl sm:max-h-[90vh] sm:rounded-md sm:pb-0"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 id="login-sessions-title" className="font-semibold text-brand-teal">Lịch sử phiên đăng nhập</h2>
          <p className="mt-1 truncate text-xs text-muted">{user.name || user.username || user.email} · {activeCount}/{sessions.length} phiên còn hiệu lực</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onRefresh} disabled={loading || Boolean(actionId)} className="min-h-11 rounded-sm border border-line px-3 text-sm text-brand-teal hover:bg-brand/5 disabled:opacity-50">Làm mới</button>
          <button type="button" onClick={onClose} disabled={Boolean(actionId)} aria-label="Đóng" className="min-h-11 min-w-11 text-xl leading-none text-muted disabled:opacity-50">×</button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {error && <div role="alert" className="mb-3 rounded-sm border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {loading ? <div className="p-8 text-center text-sm text-muted">Đang tải lịch sử phiên đăng nhập…</div> : sessions.length === 0 ? (
          !error && <div className="rounded-md border border-dashed border-line p-8 text-center text-sm text-muted">Chưa có phiên đăng nhập nào được lưu.</div>
        ) : <div className="space-y-3">
          {sessions.map((session) => <article key={session.id} className="rounded-md border border-line bg-white p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-ink">{deviceLabel(session.user_agent)}</h3>
                  {session.is_current && <span className="rounded-full bg-brand/15 px-2 py-1 text-xs font-medium text-brand-teal">Thiết bị này</span>}
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${session.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                    {session.is_active ? "Còn hiệu lực" : "Đã hết hạn"}
                  </span>
                </div>
                <p className="mt-1 break-all text-xs text-muted" title={session.user_agent || undefined}>{session.user_agent || "Không có thông tin trình duyệt"}</p>
              </div>
              {session.is_active && <button
                type="button"
                onClick={() => onRevoke(session)}
                disabled={Boolean(actionId)}
                aria-label={`Đăng xuất ${deviceLabel(session.user_agent)}`}
                className="min-h-11 shrink-0 rounded-sm border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {actionId === session.id ? "Đang đăng xuất…" : "Đăng xuất thiết bị"}
              </button>}
            </div>
            <dl className="mt-3 grid gap-x-4 gap-y-2 border-t border-line pt-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-muted">Địa chỉ IP</dt><dd className="mt-0.5 font-medium text-ink">{session.ip_address || "—"}</dd></div>
              <div><dt className="text-muted">Đăng nhập lúc</dt><dd className="mt-0.5 font-medium text-ink">{formatDateTime(session.created_at)}</dd></div>
              <div><dt className="text-muted">Hoạt động gần nhất</dt><dd className="mt-0.5 font-medium text-ink">{formatDateTime(session.last_seen_at)}</dd></div>
              <div><dt className="text-muted">Hết hạn lúc</dt><dd className="mt-0.5 font-medium text-ink">{formatDateTime(session.expires_at)}</dd></div>
            </dl>
          </article>)}
        </div>}
      </div>

      <div className="flex justify-end border-t border-line bg-surface px-4 py-3 sm:px-5">
        <button type="button" onClick={onClose} disabled={Boolean(actionId)} className="min-h-11 rounded-sm border border-line px-4 py-2 text-sm hover:bg-surface-muted disabled:opacity-50">Đóng</button>
      </div>
    </div>
  </div>;
}
