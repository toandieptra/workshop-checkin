"use client";

// Kênh Zalo cá nhân qua Smax (thay zalo-agent bridge): admin bật kênh được dùng để gửi tin / tra SĐT
// và chọn một kênh mặc định. Khi gửi hàng loạt có thể đổi sang kênh khác đã bật.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { apiPath } from "@/lib/survey-admin";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";

type Channel = { page_pid: string; name: string; enabled: boolean; is_default: boolean; connection_error: string | null; synced_at: string | null };
export type ZaloUserStatus = { provider: "smax" | "bridge"; smax_configured: boolean; biz: string | null; channels: Channel[] };

export default function ZaloSmaxChannelsPanel({ onStatus }: { onStatus?: (s: ZaloUserStatus) => void }) {
  const { can } = useAuth();
  const manage = can(PERMISSIONS.connectionsManage);
  const [status, setStatus] = useState<ZaloUserStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api<ZaloUserStatus>(apiPath("/api/zalo-user/status"), { adminLoading: false });
      setStatus(s); onStatus?.(s); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Không tải được kênh Zalo"); }
  }, [onStatus]);
  useEffect(() => { void load(); }, [load]);

  const run = async (path: string, init: RequestInit) => {
    setBusy(true);
    try {
      await api(apiPath(path), { ...init, headers: { "Content-Type": "application/json" } });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Thao tác thất bại"); }
    finally { setBusy(false); }
  };
  const update = (pid: string, body: { enabled?: boolean; is_default?: boolean }) =>
    run(`/api/zalo-user/channels/${encodeURIComponent(pid)}`, { method: "PUT", body: JSON.stringify(body) });

  if (!status) return error ? <section className="rounded-lg border border-line bg-white p-5 text-sm text-error">{error}</section> : null;
  if (!status.smax_configured) return null;

  const enabledCount = status.channels.filter((c) => c.enabled).length;
  const def = status.channels.find((c) => c.is_default);
  return <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-lg font-bold text-ink">Zalo cá nhân qua Smax</h2>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${def ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
            {def ? `Mặc định: ${def.name}` : "Chưa chọn kênh mặc định"}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">
          Gửi mẫu tin Zalo và tra Zalo theo SĐT qua các kênh Zalo cá nhân của Smax <strong>{status.biz}</strong>
          {status.provider === "smax" ? " (đang dùng thay zalo-agent bridge)" : ""}. Bật kênh được phép dùng và chọn một kênh mặc định.
        </p>
        <p className="mt-1 text-xs text-muted">Đang bật {enabledCount}/{status.channels.length} kênh</p>
      </div>
      {manage && <button type="button" disabled={busy} onClick={() => run("/api/zalo-user/channels/sync", { method: "POST" })}
        className="min-h-10 shrink-0 whitespace-nowrap rounded-md border border-line px-4 text-sm font-semibold disabled:opacity-50">Đồng bộ kênh</button>}
    </div>
    {error && <p className="mt-3 text-sm text-error">{error}</p>}
    <div className="mt-4 overflow-hidden rounded-md border border-line">
      {status.channels.length === 0 && <p className="p-4 text-sm text-muted">Smax chưa có kênh Zalo cá nhân nào.</p>}
      {status.channels.map((c) => <div key={c.page_pid} className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="font-semibold text-ink">{c.name} {c.is_default && <span className="ml-1 rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand-teal">Mặc định</span>}</div>
          <div className="text-xs text-muted"><span className="font-mono">{c.page_pid}</span>{c.connection_error && <span className="ml-2 font-semibold text-error">{c.connection_error}</span>}</div>
        </div>
        {manage && <div className="flex shrink-0 items-center gap-2">
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-line px-3 text-sm">
            <input type="checkbox" checked={c.enabled} disabled={busy} onChange={(e) => void update(c.page_pid, { enabled: e.target.checked })} />
            Dùng
          </label>
          <button type="button" disabled={busy || c.is_default || !!c.connection_error} onClick={() => void update(c.page_pid, { is_default: true })}
            className="min-h-10 rounded-md border border-brand px-3 text-sm font-semibold text-brand-teal disabled:opacity-40">Đặt mặc định</button>
        </div>}
      </div>)}
    </div>
  </section>;
}
