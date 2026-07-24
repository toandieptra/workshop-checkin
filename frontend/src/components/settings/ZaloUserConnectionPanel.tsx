"use client";

import { useCallback, useEffect, useState } from "react";
import { getZaloAgentLogin, getZaloAgentStatus, listZaloAgentAccounts, logoutZaloAgent, reconnectZaloAgent, removeZaloAgentAccount, startZaloAgentLogin, switchZaloAgentAccount } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";
import type { ZaloAgentAccount, ZaloAgentStatus, ZaloQrSession } from "@/types/zalo-agent";

export default function ZaloUserConnectionPanel() {
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.connectionsManage);
  const [status, setStatus] = useState<ZaloAgentStatus | null>(null);
  const [accounts, setAccounts] = useState<ZaloAgentAccount[]>([]);
  const [qr, setQr] = useState<ZaloQrSession | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy("load");
    setError("");
    try {
      const [nextStatus, nextAccounts] = await Promise.all([getZaloAgentStatus(), listZaloAgentAccounts()]);
      setStatus(nextStatus);
      setAccounts(nextAccounts);
    } catch (loadError) {
      setStatus({ available: false, loggedIn: false, ownId: null, activeAccount: null });
      setError(loadError instanceof Error ? loadError.message : "Không kết nối được Zalo Agent Bridge.");
    } finally { setBusy(""); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!qr || qr.status !== "waiting") return;
    const timer = window.setInterval(async () => {
      try {
        const next = await getZaloAgentLogin(qr.sessionId);
        setQr(next);
        if (next.status === "connected") void load();
      } catch (pollError) {
        setError(pollError instanceof Error ? pollError.message : "Không đọc được trạng thái đăng nhập.");
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [load, qr]);

  const act = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name);
    setError("");
    try { await action(); await load(); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Thao tác thất bại."); }
    finally { setBusy(""); }
  };

  const beginLogin = async () => {
    setBusy("login");
    setError("");
    try { setQr(await startZaloAgentLogin()); }
    catch (loginError) { setError(loginError instanceof Error ? loginError.message : "Không tạo được mã QR."); }
    finally { setBusy(""); }
  };

  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-lg font-bold text-ink">Zalo User</h2>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status?.loggedIn ? "bg-green-50 text-green-700" : status?.available ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{status?.loggedIn ? "Đã đăng nhập" : status?.available ? "Chưa đăng nhập" : "Bridge offline"}</span>
          </div>
          <p className="mt-1 text-sm text-muted">Tài khoản Zalo cá nhân qua `zalo-agent`; credential luôn nằm trên máy chạy bridge.</p>
          {status?.version && <p className="mt-1 text-xs text-muted">zalo-agent {status.version} · MCP {status.mcpHealthy ? "đang hoạt động" : status.mcpRunning ? "đang khởi động" : "đã dừng"}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void load()} disabled={!!busy} className="min-h-10 rounded-md border border-line px-4 text-sm font-semibold disabled:opacity-50">Làm mới</button>
          {canManage && <button type="button" onClick={() => void act("reconnect", reconnectZaloAgent)} disabled={!!busy || !status?.available} className="min-h-10 rounded-md border border-brand px-4 text-sm font-semibold text-brand-teal disabled:opacity-50">Kiểm tra phiên</button>}
          {canManage && <button type="button" onClick={() => void beginLogin()} disabled={!!busy || !status?.available} className="min-h-10 rounded-md bg-brand px-4 text-sm font-semibold text-brand-teal disabled:opacity-50">Thêm tài khoản</button>}
        </div>
      </div>

      {status?.activeAccount && <div className="mt-5 rounded-md bg-surface-muted p-4"><div className="text-xs font-semibold uppercase tracking-wide text-muted">Tài khoản đang hoạt động</div><div className="mt-1 font-bold text-ink">{status.activeAccount.name || status.activeAccount.ownId}</div><div className="mt-0.5 font-mono text-xs text-muted">{status.activeAccount.ownId}</div></div>}
      {status?.lastError && <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{status.lastError}</div>}

      {qr?.status === "waiting" && qr.qrDataUrl && <div className="mt-5 rounded-md border border-brand/30 bg-brand/5 p-4 text-center"><p className="mb-3 text-sm font-semibold text-ink">Quét mã bằng ứng dụng Zalo</p><img src={qr.qrDataUrl} alt="Mã QR đăng nhập Zalo" className="mx-auto h-56 w-56 rounded bg-white p-2" /><p className="mt-3 text-xs text-muted">Mã sẽ tự hết hạn; không đóng trang trong khi quét.</p></div>}
      {qr?.status === "connected" && <div className="mt-4 rounded-md border border-success-border bg-success-soft p-3 text-sm text-success">Đăng nhập Zalo thành công.</div>}
      {qr && ["error", "expired"].includes(qr.status) && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-error">{qr.error || "Phiên đăng nhập đã hết hạn."}</div>}

      <div className="mt-5 overflow-hidden rounded-md border border-line">
        <div className="border-b border-line bg-surface-muted px-4 py-3 text-sm font-bold text-ink">Tài khoản đã lưu</div>
        {accounts.map((account) => <div key={account.ownId} className="flex flex-col gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-semibold text-ink">{account.name || account.ownId}{account.active && <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">Đang dùng</span>}</div><div className="font-mono text-xs text-muted">{account.ownId} · Proxy: {account.proxy || "Không dùng"}</div></div>{canManage && <div className="flex gap-2"><button type="button" disabled={!!busy || account.active} onClick={() => void act(`switch-${account.ownId}`, () => switchZaloAgentAccount(account.ownId))} className="rounded border border-line px-3 py-2 text-xs font-semibold disabled:opacity-40">Chuyển sang</button><button type="button" disabled={!!busy || account.active} onClick={() => { if (window.confirm(`Xóa tài khoản ${account.name || account.ownId} khỏi bridge?`)) void act(`remove-${account.ownId}`, () => removeZaloAgentAccount(account.ownId)); }} className="rounded border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-40">Xóa</button></div>}</div>)}
        {!accounts.length && <div className="px-4 py-8 text-center text-sm text-muted">Chưa có tài khoản Zalo được lưu trên bridge.</div>}
      </div>
      {canManage && status?.loggedIn && <button type="button" onClick={() => { if (window.confirm("Đăng xuất và xóa credential của tài khoản đang hoạt động? Bạn sẽ phải quét QR để kết nối lại.")) void act("logout", () => logoutZaloAgent(true)); }} disabled={!!busy} className="mt-4 text-sm font-semibold text-red-700 disabled:opacity-50">Đăng xuất và xóa credential</button>}
      {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-error">{error}</div>}
    </section>
  );
}
