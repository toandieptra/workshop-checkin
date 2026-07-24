"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getZaloDelivery, listZaloDeliveries, listZaloMessageTemplates, preflightZaloRecipient, refreshZaloDeliveryItem, retryZaloDeliveryItem, sendZaloMessage } from "@/lib/api";
import type { ZaloDelivery, ZaloMessageBlock, ZaloMessageTemplate } from "@/types/zalo-message";

function errorText(error: unknown) { return error instanceof Error ? error.message : "Không rõ lỗi"; }
function date(value?: string | null) { return value ? new Date(value).toLocaleString("vi-VN") : "—"; }

function images(block: ZaloMessageBlock) {
  return block.images?.length ? block.images : block.url ? [{ id: `${block.id}-legacy`, url: block.url }] : [];
}

function Album({ block }: { block: ZaloMessageBlock }) {
  const album = images(block);
  return album.length ? <div className={`grid gap-1 ${album.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
    {album.map((image, index) => <div key={image.id} className="aspect-square overflow-hidden bg-surface-muted"><img src={image.url} alt={`Ảnh ${index + 1} trong album`} className="h-full w-full object-cover" /></div>)}
  </div> : <div className="p-5 text-center text-xs text-muted">Album chưa có ảnh</div>;
}

function Preview({ blocks }: { blocks: ZaloMessageBlock[] }) {
  return <div className="space-y-2 rounded-xl bg-[#e9f5f7] p-3">
    {blocks.map((block) => <div key={block.id} className="overflow-hidden rounded-lg bg-white shadow-sm">
      {block.type === "text" && <div className="whitespace-pre-wrap break-words px-3 py-2 text-sm text-ink">{block.text || "Nội dung văn bản..."}</div>}
      {block.type === "image" && <Album block={block} />}
      {block.type === "video" && <div className="grid min-h-24 place-items-center bg-[#173b42] text-2xl text-white">▶</div>}
    </div>)}
  </div>;
}

function snapshotBlocks(blocks: Array<Record<string, unknown>>): ZaloMessageBlock[] {
  const result: ZaloMessageBlock[] = [];
  blocks.forEach((block, index) => {
    if (block.type === "image_album") {
      result.push({
        id: String(block.id || index),
        type: "image",
        images: (Array.isArray(block.images) ? block.images : []).flatMap((image, imageIndex) => typeof image === "object" && image && "url" in image ? [{ id: String("id" in image && image.id || `${index}-${imageIndex}`), url: String(image.url || "") }] : []),
      });
      return;
    }
    result.push({
      id: String(block.id || index),
      type: block.type as ZaloMessageBlock["type"],
      text: typeof block.text === "string" ? block.text : undefined,
      ...(block.type === "image" && typeof block.url === "string" ? { images: [{ id: String(block.id || `${index}-0`), url: block.url }] } : { url: typeof block.url === "string" ? block.url : undefined }),
      thumbnail_url: typeof block.thumbnail_url === "string" ? block.thumbnail_url : undefined,
    });
  });
  return result;
}

function DeliveryModal({ delivery, onClose, onChanged, canSend }: { delivery: ZaloDelivery; onClose: () => void; onChanged: () => void; canSend: boolean }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const action = async (itemId: string, kind: "refresh" | "retry") => {
    setBusy(itemId + kind); setError("");
    try { if (kind === "refresh") await refreshZaloDeliveryItem(itemId); else await retryZaloDeliveryItem(itemId); onChanged(); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(""); }
  };
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Chi tiết gửi tin Zalo">
    <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl">
      <div className="flex items-start justify-between gap-3"><div><h3 className="font-heading text-lg font-bold text-ink">{delivery.template_name}</h3><p className="text-xs text-muted">{date(delivery.created_at)} · {delivery.status}</p></div><button type="button" onClick={onClose} className="text-2xl text-muted" aria-label="Đóng">×</button></div>
      {error && <div className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-error">{error}</div>}
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm"><div className="rounded border border-line p-2"><strong>{delivery.recipient_count}</strong><div className="text-xs text-muted">Người nhận</div></div><div className="rounded border border-line p-2"><strong>{delivery.sent_count}</strong><div className="text-xs text-muted">Đã gửi</div></div><div className="rounded border border-line p-2"><strong>{delivery.failed_count}</strong><div className="text-xs text-muted">Lỗi</div></div></div>
      <div className="mt-4"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Nội dung đã gửi</div><Preview blocks={snapshotBlocks(delivery.content_blocks)} /></div>
      <div className="mt-4 space-y-2">{delivery.items.map((item) => <div key={item.id} className="rounded border border-line p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold text-ink">{item.recipient_name || item.phone || item.guest_id || "Người nhận"}</div><span className={item.status === "failed" ? "text-red-600" : "text-muted"}>{item.status}</span></div><div className="mt-1 text-xs text-muted">Thử {item.attempt_count} lần · {date(item.sent_at || item.updated_at)}</div>{item.last_error && <div className="mt-2 text-xs text-red-600">{item.last_error}</div>}{canSend && item.status === "failed" && <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={!!busy} onClick={() => void action(item.id, "refresh")} className="min-h-8 rounded border border-brand px-3 text-xs font-semibold text-brand">{busy === item.id + "refresh" ? "Đang refresh..." : "Refresh recipient"}</button><button type="button" disabled={!!busy || !item.recipient_id} onClick={() => void action(item.id, "retry")} className="min-h-8 rounded bg-brand px-3 text-xs font-semibold text-brand-teal disabled:opacity-40">{busy === item.id + "retry" ? "Đang retry..." : "Gửi lại"}</button></div>}</div>)}</div>
    </div>
  </div>;
}

export default function GuestZaloMessageBlock({ guestId, workshopId, canRead, canSend }: { guestId: string; workshopId: string; canRead: boolean; canSend: boolean }) {
  const [templates, setTemplates] = useState<ZaloMessageTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [recipient, setRecipient] = useState<{ resolved: boolean; name?: string } | null>(null);
  const [deliveries, setDeliveries] = useState<ZaloDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<ZaloDelivery | null>(null);
  const [historyCount, setHistoryCount] = useState(5);
  const activeTemplate = templates.find((template) => template.id === templateId);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [templateResult, historyResult] = await Promise.all([canSend ? listZaloMessageTemplates({ status: "active", limit: 100 }) : Promise.resolve({ data: [], metadata: { total: 0, offset: 0, limit: 100 } }), canRead ? listZaloDeliveries(guestId) : Promise.resolve([])]);
      setTemplates(templateResult.data); setTemplateId((current) => current || templateResult.data[0]?.id || "");
      setDeliveries(historyResult.filter((delivery) => delivery.items.some((item) => item.guest_id === guestId)));
    } catch (e) { setError("Không tải được dữ liệu Zalo: " + errorText(e)); }
    finally { setLoading(false); }
  }, [canRead, canSend, guestId]);
  useEffect(() => { void load(); }, [load]);

  const refreshRecipient = async () => {
    if (!templateId) return;
    setBusy("recipient"); setError("");
    try { const result = await preflightZaloRecipient({ template_id: templateId, guest_id: guestId, refresh_recipients: true }); setRecipient({ resolved: result.resolved_count > 0 }); }
    catch (e) { setError("Không refresh được recipient: " + errorText(e)); }
    finally { setBusy(""); }
  };
  const send = async () => {
    if (!activeTemplate || !window.confirm(`Gửi mẫu “${activeTemplate.name}” cho khách này?`)) return;
    setBusy("send"); setError("");
    try { await sendZaloMessage({ template_id: activeTemplate.id, guest_id: guestId }); setRecipient({ resolved: true }); await load(); }
    catch (e) { setError("Gửi tin thất bại: " + errorText(e)); }
    finally { setBusy(""); }
  };
  const shownDeliveries = useMemo(() => deliveries.slice(0, historyCount), [deliveries, historyCount]);
  if (!canRead && !canSend) return null;

  return <section className="rounded-md border border-line bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold text-ink">Tin nhắn Zalo</h4><p className="mt-1 text-xs text-muted">Gửi thủ công theo mẫu active và theo dõi delivery của khách.</p></div>{canRead && <button type="button" onClick={() => void load()} disabled={loading} className="min-h-9 rounded border border-line px-3 text-xs font-semibold text-brand-teal">{loading ? "Đang tải..." : "Làm mới"}</button>}</div>
    {error && <div className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-error">{error}<button type="button" onClick={() => void load()} className="ml-2 underline">Thử lại</button></div>}
    {canSend && <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]"><div><label className="block text-xs font-semibold text-text-secondary">Mẫu đang sử dụng<select value={templateId} onChange={(e) => { setTemplateId(e.target.value); setRecipient(null); }} className="mt-1 min-h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-brand"><option value="">Chọn template active</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><div className="mt-2 text-xs text-muted">Backend hiện chỉ gửi template nguyên bản, chưa hỗ trợ sửa text theo từng lần gửi.</div><div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" disabled={!templateId || !!busy} onClick={() => void refreshRecipient()} className="min-h-9 rounded border border-brand px-3 text-xs font-semibold text-brand">{busy === "recipient" ? "Đang refresh..." : "Refresh recipient"}</button><span className={`text-xs font-semibold ${recipient?.resolved ? "text-green-700" : "text-muted"}`}>{recipient ? (recipient.resolved ? "Recipient đã resolve" : "Chưa resolve recipient") : "Chưa kiểm tra recipient"}</span></div><button type="button" disabled={!templateId || !!busy} onClick={() => void send()} className="mt-3 min-h-10 rounded bg-brand px-4 text-sm font-semibold text-brand-teal disabled:opacity-40">{busy === "send" ? "Đang xếp hàng..." : "Xác nhận và gửi"}</button></div>{activeTemplate && <Preview blocks={activeTemplate.blocks} />}</div>}
    {canRead && <div className="mt-5 border-t border-line pt-4"><h5 className="text-sm font-semibold text-ink">Lịch sử gửi gần đây</h5>{loading ? <div className="mt-3 text-sm text-muted">Đang tải lịch sử...</div> : !shownDeliveries.length ? <div className="mt-3 text-sm text-muted">Chưa có delivery cho khách này.</div> : <div className="mt-3 space-y-2">{shownDeliveries.map((delivery) => <button type="button" key={delivery.id} onClick={() => void getZaloDelivery(delivery.id).then(setDetail).catch((e) => setError(errorText(e)))} className="block w-full rounded border border-line p-3 text-left hover:bg-brand/5"><div className="flex justify-between gap-2 text-sm"><strong>{delivery.template_name}</strong><span className={delivery.failed_count ? "text-red-600" : "text-muted"}>{delivery.status}</span></div><div className="mt-1 text-xs text-muted">{date(delivery.created_at)} · {delivery.sent_count}/{delivery.recipient_count} đã gửi · Xem chi tiết</div></button>)}</div>}{historyCount < deliveries.length && <button type="button" onClick={() => setHistoryCount((count) => count + 5)} className="mt-3 min-h-9 rounded border border-line px-3 text-xs font-semibold text-brand">Xem thêm</button>}</div>}
    {detail && <DeliveryModal delivery={detail} canSend={canSend} onClose={() => setDetail(null)} onChanged={() => void getZaloDelivery(detail.id).then(setDetail).then(() => void load())} />}
  </section>;
}
