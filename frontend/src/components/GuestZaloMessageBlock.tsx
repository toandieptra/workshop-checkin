"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";
import { getZaloDelivery, listZaloDeliveries } from "@/lib/api";
import ZaloDeliveryModal from "@/components/ZaloDeliveryModal";
import type { ZaloDelivery } from "@/types/zalo-message";

function errorText(error: unknown) { return error instanceof Error ? error.message : "Không rõ lỗi"; }
function date(value?: string | null) { return value ? new Date(value).toLocaleString("vi-VN") : "—"; }

export default function GuestZaloMessageBlock({ guestId, canRead, canSend }: { guestId: string; canRead: boolean; canSend: boolean }) {
  const { user, can, canForWorkshop } = useAuth();
  const scope = JSON.stringify([guestId, canRead, canSend, user?.permissions, user?.workshop_access]);
  const live = useRef({ scope, revision: 0 });
  if (live.current.scope !== scope) live.current = { scope, revision: live.current.revision + 1 };
  const [deliveries, setDeliveries] = useState<ZaloDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<ZaloDelivery | null>(null);
  const [historyCount, setHistoryCount] = useState(5);
  const canReadDelivery = (delivery: ZaloDelivery) => delivery.items.every((item) => item.guest_id
    ? !!item.workshop_id && canForWorkshop(PERMISSIONS.zaloMessagesView, item.workshop_id)
    : can(PERMISSIONS.zaloMessagesView));

  const load = useCallback(async () => {
    const request = ++live.current.revision;
    setLoading(true); setError("");
    try {
      const result = canRead ? await listZaloDeliveries(guestId) : [];
      if (live.current.scope === scope && request === live.current.revision) setDeliveries(result.filter((delivery) => delivery.items.some((item) => item.guest_id === guestId)));
    } catch (e) {
      if (live.current.scope === scope && request === live.current.revision) { setDeliveries([]); setDetail(null); setError("Không tải được dữ liệu Zalo: " + errorText(e)); }
    } finally { if (live.current.scope === scope && request === live.current.revision) setLoading(false); }
  }, [canRead, guestId, scope]);
  useEffect(() => {
    setDeliveries([]); setDetail(null); setHistoryCount(5);
    void load();
    return () => { live.current.revision++; };
  }, [load]);
  const openDetail = async (id: string) => {
    const snapshot = live.current.revision;
    try {
      const result = await getZaloDelivery(id);
      if (live.current.scope === scope && snapshot === live.current.revision) setDetail(result);
    } catch (e) { if (live.current.scope === scope && snapshot === live.current.revision) { setDetail(null); setError(errorText(e)); } }
  };
  const shownDeliveries = useMemo(() => deliveries.filter(canReadDelivery).slice(0, historyCount), [deliveries, historyCount, can, canForWorkshop]);
  if (!canRead) return null;

  return <section className="rounded-md border border-line bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold text-ink">Tin nhắn Zalo</h4><p className="mt-1 text-xs text-muted">Theo dõi lịch sử gửi tin nhắn của khách.</p></div>{canRead && <button type="button" onClick={() => void load()} disabled={loading} className="min-h-9 rounded border border-line px-3 text-xs font-semibold text-brand-teal">{loading ? "Đang tải..." : "Làm mới"}</button>}</div>
    {error && <div className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-error">{error}<button type="button" onClick={() => void load()} className="ml-2 underline">Thử lại</button></div>}
    {canRead && <div className="mt-5 border-t border-line pt-4"><h5 className="text-sm font-semibold text-ink">Lịch sử gửi gần đây</h5>{loading ? <div className="mt-3 text-sm text-muted">Đang tải lịch sử...</div> : !shownDeliveries.length ? <div className="mt-3 text-sm text-muted">Chưa có delivery cho khách này.</div> : <div className="mt-3 space-y-2">{shownDeliveries.map((delivery) => <button type="button" key={delivery.id} onClick={() => void openDetail(delivery.id)} className="block w-full rounded border border-line p-3 text-left hover:bg-brand/5"><div className="flex justify-between gap-2 text-sm"><strong>{delivery.template_name}</strong><span className={delivery.failed_count ? "text-red-600" : "text-muted"}>{delivery.status}</span></div><div className="mt-1 text-xs text-muted">{date(delivery.created_at)} · {delivery.sent_count}/{delivery.recipient_count} đã gửi · Xem chi tiết</div></button>)}</div>}{historyCount < deliveries.length && <button type="button" onClick={() => setHistoryCount((count) => count + 5)} className="mt-3 min-h-9 rounded border border-line px-3 text-xs font-semibold text-brand">Xem thêm</button>}</div>}
    {detail && canReadDelivery(detail) && <ZaloDeliveryModal delivery={detail} canSend={canSend} onClose={() => setDetail(null)} onChanged={() => void load().then(() => openDetail(detail.id))} />}
  </section>;
}
