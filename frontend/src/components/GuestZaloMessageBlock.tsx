"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getZaloDelivery, listZaloDeliveries } from "@/lib/api";
import ZaloDeliveryModal from "@/components/ZaloDeliveryModal";
import type { ZaloDelivery } from "@/types/zalo-message";

function errorText(error: unknown) { return error instanceof Error ? error.message : "Không rõ lỗi"; }
function date(value?: string | null) { return value ? new Date(value).toLocaleString("vi-VN") : "—"; }

export default function GuestZaloMessageBlock({ guestId, canRead, canSend }: { guestId: string; canRead: boolean; canSend: boolean }) {
  const [deliveries, setDeliveries] = useState<ZaloDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<ZaloDelivery | null>(null);
  const [historyCount, setHistoryCount] = useState(5);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const historyResult = canRead ? await listZaloDeliveries(guestId) : [];
      setDeliveries(historyResult.filter((delivery) => delivery.items.some((item) => item.guest_id === guestId)));
    } catch (e) { setError("Không tải được dữ liệu Zalo: " + errorText(e)); }
    finally { setLoading(false); }
  }, [canRead, guestId]);
  useEffect(() => { void load(); }, [load]);
  const shownDeliveries = useMemo(() => deliveries.slice(0, historyCount), [deliveries, historyCount]);
  if (!canRead) return null;

  return <section className="rounded-md border border-line bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold text-ink">Tin nhắn Zalo</h4><p className="mt-1 text-xs text-muted">Theo dõi lịch sử gửi tin nhắn của khách.</p></div>{canRead && <button type="button" onClick={() => void load()} disabled={loading} className="min-h-9 rounded border border-line px-3 text-xs font-semibold text-brand-teal">{loading ? "Đang tải..." : "Làm mới"}</button>}</div>
    {error && <div className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-error">{error}<button type="button" onClick={() => void load()} className="ml-2 underline">Thử lại</button></div>}
    {canRead && <div className="mt-5 border-t border-line pt-4"><h5 className="text-sm font-semibold text-ink">Lịch sử gửi gần đây</h5>{loading ? <div className="mt-3 text-sm text-muted">Đang tải lịch sử...</div> : !shownDeliveries.length ? <div className="mt-3 text-sm text-muted">Chưa có delivery cho khách này.</div> : <div className="mt-3 space-y-2">{shownDeliveries.map((delivery) => <button type="button" key={delivery.id} onClick={() => void getZaloDelivery(delivery.id).then(setDetail).catch((e) => setError(errorText(e)))} className="block w-full rounded border border-line p-3 text-left hover:bg-brand/5"><div className="flex justify-between gap-2 text-sm"><strong>{delivery.template_name}</strong><span className={delivery.failed_count ? "text-red-600" : "text-muted"}>{delivery.status}</span></div><div className="mt-1 text-xs text-muted">{date(delivery.created_at)} · {delivery.sent_count}/{delivery.recipient_count} đã gửi · Xem chi tiết</div></button>)}</div>}{historyCount < deliveries.length && <button type="button" onClick={() => setHistoryCount((count) => count + 5)} className="mt-3 min-h-9 rounded border border-line px-3 text-xs font-semibold text-brand">Xem thêm</button>}</div>}
    {detail && <ZaloDeliveryModal delivery={detail} canSend={canSend} onClose={() => setDetail(null)} onChanged={() => void getZaloDelivery(detail.id).then(setDetail).then(() => void load())} />}
  </section>;
}
