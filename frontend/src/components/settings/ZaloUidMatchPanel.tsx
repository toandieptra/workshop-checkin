"use client";

// Ghép UID Zalo: người dùng OA (quan tâm / nhắn tin) chưa có SĐT → gợi ý khách theo tên Zalo; xác nhận, từ chối,
// ghép tay theo SĐT, hoặc gỡ ghép (vd. tự ghép sai).
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { apiPath } from "@/lib/survey-admin";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";

type GuestRef = { id: string; full_name: string; phone: string | null; workshop_name: string | null; registered_at: string | null };
type Suggestion = { id: string; status: string; score: number; reasons: string[]; phone: string; guest: GuestRef | null };
type OaUser = {
  user_id: string; display_name: string | null; avatar: string | null; is_follower: boolean | null;
  last_event: string | null; last_event_at: string | null; phone: string | null; phone_source: string | null;
};
type Data = { name_match_enabled: boolean; pending: (OaUser & { suggestions: Suggestion[] })[]; linked: (OaUser & { guest: GuestRef | null })[] };

const SOURCE: Record<string, string> = {
  oa_submit_info: "Khách chia sẻ thông tin",
  oa_user_detail: "Thông tin OA",
  name_match_auto: "Tự ghép theo tên",
  name_match_confirmed: "Nhân viên xác nhận",
  manual: "Ghép tay",
  zns_webhook: "Webhook",
};
const EVENT: Record<string, string> = { follow: "Quan tâm OA", unfollow: "Bỏ quan tâm", user_send_text: "Nhắn tin", user_submit_info: "Chia sẻ thông tin", user_received_message: "Nhận tin OA" };

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "—");

export default function ZaloUidMatchPanel() {
  const { can } = useAuth();
  const manage = can(PERMISSIONS.zbsManage);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phones, setPhones] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try { setData(await api<Data>(apiPath("/api/zalo-uid/pending"), { adminLoading: false })); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Không tải được dữ liệu"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (path: string, body?: unknown) => {
    try {
      await api(apiPath(path), { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Thao tác thất bại"); }
  };

  if (!data) return <div className="p-6 text-sm text-muted">{error || "Đang tải…"}</div>;

  return <div className="space-y-6 p-4 lg:overflow-y-auto">
    <div>
      <h2 className="text-lg font-semibold text-ink">Ghép UID Zalo</h2>
      <p className="mt-1 text-sm text-text-secondary">
        Người quan tâm hoặc nhắn tin cho OA có UID nhưng Zalo không cho biết SĐT (trừ khi khách chia sẻ thông tin).
        Hệ thống so khớp tên Zalo của họ với tên Zalo của khách mời: khớp chắc chắn thì tự ghép, còn lại hiện gợi ý ở đây.
        {!data.name_match_enabled && <span className="ml-1 font-semibold text-amber-700">Tự so khớp theo tên đang tắt.</span>}
      </p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>

    <section>
      <h3 className="font-semibold text-ink">Chờ ghép ({data.pending.length})</h3>
      {data.pending.length === 0 && <p className="mt-2 text-sm text-muted">Không có người dùng OA nào chờ ghép.</p>}
      <div className="mt-3 space-y-3">
        {data.pending.map((u) => <div key={u.user_id} className="rounded-md border border-line bg-white p-4">
          <div className="flex flex-wrap items-center gap-3">
            {u.avatar ? <img src={u.avatar} alt="" className="h-10 w-10 rounded-full object-cover" /> : <div className="h-10 w-10 rounded-full bg-line" />}
            <div className="min-w-0">
              <div className="font-semibold text-ink">{u.display_name || "(chưa có tên)"}</div>
              <div className="text-xs text-muted">{EVENT[u.last_event || ""] || u.last_event} · {fmt(u.last_event_at)} · {u.is_follower ? "đang quan tâm" : "chưa quan tâm"} · <span className="font-mono">UID {u.user_id}</span></div>
            </div>
          </div>
          {u.suggestions.length > 0 ? <div className="mt-3 divide-y divide-line rounded-md border border-line">
            {u.suggestions.map((s) => <div key={s.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-ink">{s.guest?.full_name || "—"} <span className="font-mono text-xs text-muted">{s.phone}</span></div>
                <div className="text-xs text-muted">{s.guest?.workshop_name} · đăng ký {fmt(s.guest?.registered_at)}</div>
                <div className="mt-1 text-xs text-text-secondary">Độ khớp {Math.round(s.score * 100)}% — {s.reasons.join(" · ")}</div>
              </div>
              {manage && <div className="flex gap-2">
                <button type="button" onClick={() => act(`/api/zalo-uid/suggestions/${s.id}/confirm`)} className="min-h-9 rounded-md bg-green-700 px-3 text-xs font-semibold text-white">Đúng người</button>
                <button type="button" onClick={() => act(`/api/zalo-uid/suggestions/${s.id}/reject`)} className="min-h-9 rounded-md border border-line px-3 text-xs font-semibold text-text-secondary">Không phải</button>
              </div>}
            </div>)}
          </div> : <p className="mt-3 text-xs text-muted">Chưa tìm được khách trùng tên Zalo.</p>}
          {manage && <div className="mt-3 flex flex-wrap items-center gap-2">
            <input value={phones[u.user_id] || ""} onChange={(e) => setPhones((p) => ({ ...p, [u.user_id]: e.target.value }))}
              placeholder="Ghép tay theo SĐT khách" inputMode="tel" className="min-h-9 w-56 rounded-md border border-line px-3 text-sm" />
            <button type="button" disabled={!phones[u.user_id]} onClick={() => act(`/api/zalo-uid/oa-users/${encodeURIComponent(u.user_id)}/link`, { phone: phones[u.user_id] })}
              className="min-h-9 rounded-md border border-brand px-3 text-xs font-semibold text-brand disabled:opacity-40">Ghép</button>
          </div>}
        </div>)}
      </div>
    </section>

    <section>
      <h3 className="font-semibold text-ink">Đã ghép gần đây</h3>
      {data.linked.length === 0 && <p className="mt-2 text-sm text-muted">Chưa có.</p>}
      <div className="mt-3 divide-y divide-line rounded-md border border-line bg-white">
        {data.linked.map((u) => <div key={u.user_id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
          <div className="min-w-0 flex-1">
            <div className="font-medium text-ink">{u.display_name || "—"} → {u.guest?.full_name || "(không còn khách)"} <span className="font-mono text-xs text-muted">{u.phone}</span></div>
            <div className="text-xs text-muted">{SOURCE[u.phone_source || ""] || u.phone_source} · <span className="font-mono">UID {u.user_id}</span></div>
          </div>
          {manage && <button type="button" onClick={() => void act(`/api/zalo-uid/oa-users/${encodeURIComponent(u.user_id)}/unlink`)}
            className="min-h-9 rounded-md border border-red-200 px-3 text-xs font-semibold text-red-600">Gỡ ghép</button>}
        </div>)}
      </div>
    </section>
  </div>;
}
