"use client";

// Broadcast Zalo: gửi một block Smax (Zalo User) cho các khách được chọn ở /admin, qua một kênh Zalo cá nhân,
// giãn nhịp N tin/phút (giống "Broadcast & Re-marketing" của Smax). Mỗi SĐT chỉ nhận 1 lần.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { apiPath } from "@/lib/survey-admin";
import { useDialogFocus } from "@/hooks/useDialogFocus";

type Message = { id?: string; text: string; images: string[] };
type Block = { id: string; name: string; folder: string | null; group_id: string | null; updated_at: string | null; messages: Message[] | null };
type Channel = { page_pid: string; name: string; is_default: boolean; connection_error: string | null };
type Item = { guest_id: string | null; status: string; last_error: string | null; recipient_name: string | null };
type Delivery = { id: string; status: string; recipient_count: number; sent_count: number; failed_count: number; items: Item[] };

const DONE = new Set(["success", "failed", "partial_success"]);

export default function ZaloBroadcastModal({ guests, workshopId, onClose }: {
  guests: { id: string; full_name: string; phone: string | null }[]; workshopId: string; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(true, ref);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [blockId, setBlockId] = useState("");
  const [preview, setPreview] = useState<Block | null>(null);
  const [pagePid, setPagePid] = useState("");
  const [rate, setRate] = useState(60);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const idem = useRef(crypto.randomUUID());

  const withPhone = guests.filter((g) => (g.phone || "").replace(/\D/g, "").length >= 9);
  const uniquePhones = useMemo(() => new Set(withPhone.map((g) => (g.phone || "").replace(/\D/g, "").slice(-9))).size, [withPhone]);

  useEffect(() => {
    void api<{ blocks: Block[] }>(apiPath("/api/smax/blocks"), { adminLoading: false })
      .then((r) => setBlocks(r.blocks)).catch((e) => { setBlocks([]); setError(e instanceof Error ? e.message : "Không tải được block Smax"); });
    void api<{ channels: Channel[] }>(apiPath("/api/zalo-user/channels/enabled"), { adminLoading: false })
      .then((r) => { setChannels(r.channels); setPagePid(r.channels.find((c) => c.is_default)?.page_pid || r.channels[0]?.page_pid || ""); })
      .catch(() => setChannels([]));
  }, []);

  useEffect(() => {
    setPreview(null);
    if (!blockId) return;
    void api<Block>(apiPath(`/api/smax/blocks/${encodeURIComponent(blockId)}`), { adminLoading: false }).then(setPreview).catch(() => setPreview(null));
  }, [blockId]);

  // Theo dõi tiến độ sau khi bắt đầu
  useEffect(() => {
    if (!delivery || DONE.has(delivery.status)) return;
    const t = setTimeout(() => {
      void api<Delivery>(`/zalo/deliveries/${encodeURIComponent(delivery.id)}`, { background: true }).then(setDelivery).catch(() => undefined);
    }, 4000);
    return () => clearTimeout(t);
  }, [delivery]);

  const shown = (blocks || []).filter((b) => !filter.trim() || `${b.name} ${b.folder || ""}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const msgCount = preview?.messages?.reduce((n, m) => n + (m.text.trim() ? 1 : 0) + (m.images.length ? 1 : 0), 0) || 0;
  const minutes = msgCount ? Math.ceil((uniquePhones * msgCount) / rate) : 0;

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const d = await api<Delivery>("/zalo/broadcasts", { method: "POST", body: JSON.stringify({
        block_id: blockId, page_pid: pagePid || undefined, rate_per_minute: rate, workshop_id: workshopId,
        guest_ids: withPhone.map((g) => g.id), idempotency_key: idem.current }) });
      setDelivery(d); setConfirming(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Không bắt đầu được broadcast"); }
    finally { setBusy(false); }
  };

  const sentGuests = delivery ? new Set(delivery.items.filter((i) => i.status === "sent").map((i) => i.guest_id)).size : 0;
  const failedItems = delivery ? delivery.items.filter((i) => i.status === "failed") : [];
  const failedGuests = new Set(failedItems.map((i) => i.guest_id)).size;
  const nameOf = (id: string | null) => guests.find((g) => g.id === id)?.full_name || "—";

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Broadcast Zalo" tabIndex={-1}
      className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-lg bg-surface shadow-xl sm:rounded-lg">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
        <div>
          <h2 className="font-heading text-lg font-bold text-ink">Broadcast Zalo</h2>
          <p className="text-xs text-muted">{guests.length} khách đã chọn · {withPhone.length} có SĐT · {uniquePhones} số khác nhau (mỗi số nhận 1 lần)</p>
        </div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Đóng" className="min-h-10 min-w-10 text-2xl leading-none text-muted">×</button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
        {error && <p role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-error">{error}</p>}

        {delivery ? <div className="space-y-4">
          <div className="rounded-md border border-line p-4">
            <div className="font-semibold text-ink">{DONE.has(delivery.status) ? "Đã chạy xong" : "Đang gửi…"}</div>
            <div className="mt-2 h-2 overflow-hidden rounded bg-line">
              <div className="h-full bg-brand" style={{ width: `${Math.round(((sentGuests + failedGuests) / Math.max(1, delivery.recipient_count)) * 100)}%` }} />
            </div>
            <div className="mt-2 text-text-secondary">Thành công <strong className="text-green-700">{sentGuests}</strong> · Thất bại <strong className="text-error">{failedGuests}</strong> · Tổng {delivery.recipient_count} khách</div>
            <p className="mt-1 text-xs text-muted">Có thể đóng cửa sổ — broadcast vẫn chạy nền. Xem lại ở Cài đặt → Tin nhắn Zalo → Lịch sử gửi.</p>
          </div>
          {failedItems.length > 0 && <div className="rounded-md border border-line">
            <div className="border-b border-line bg-surface-muted px-3 py-2 text-xs font-semibold uppercase text-muted">Khách gửi thất bại</div>
            <ul className="max-h-48 divide-y divide-line overflow-y-auto">
              {Array.from(new Map(failedItems.map((i) => [i.guest_id, i])).values()).map((i) => <li key={i.guest_id || Math.random()} className="flex justify-between gap-3 px-3 py-2"><span>{nameOf(i.guest_id)}</span><span className="text-xs text-muted">{i.last_error}</span></li>)}
            </ul>
          </div>}
        </div> : <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
          <div>
            <div className="mb-2 font-semibold text-ink">1. Chọn block Smax (Zalo User)</div>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Tìm block hoặc thư mục…" className="mb-2 min-h-10 w-full rounded-md border border-line px-3" />
            <div className="max-h-72 overflow-y-auto rounded-md border border-line">
              {blocks === null && <p className="p-3 text-muted">Đang tải block…</p>}
              {blocks && shown.length === 0 && <p className="p-3 text-muted">Không có block Zalo User.</p>}
              {shown.map((b) => <button key={b.id} type="button" onClick={() => setBlockId(b.id)}
                className={`block w-full border-b border-line px-3 py-2 text-left last:border-b-0 ${blockId === b.id ? "bg-brand/15" : "hover:bg-surface-muted"}`}>
                <div className="font-medium text-ink">{b.name}</div>
                <div className="text-xs text-muted">{b.folder || "Không có thư mục"}{b.updated_at ? ` · ${new Date(b.updated_at).toLocaleDateString("vi-VN")}` : ""}</div>
              </button>)}
            </div>
          </div>
          <div className="space-y-3">
            <div className="font-semibold text-ink">2. Xem trước & cấu hình</div>
            <div className="min-h-24 rounded-md border border-line bg-surface-muted p-3">
              {!blockId && <p className="text-muted">Chọn một block để xem nội dung.</p>}
              {blockId && !preview && <p className="text-muted">Đang tải nội dung…</p>}
              {preview?.messages?.map((m, i) => <div key={i} className="mb-2 last:mb-0">
                {m.text && <p className="whitespace-pre-wrap rounded bg-white px-2 py-1">{m.text}</p>}
                {m.images.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{m.images.map((u) => <img key={u} src={u} alt="" className="h-16 w-16 rounded object-cover" />)}</div>}
              </div>)}
              {preview && !preview.messages?.length && <p className="text-error">Block không có tin chữ/ảnh để gửi.</p>}
            </div>
            <label className="block font-semibold text-text-secondary">Gửi từ kênh Zalo
              <select value={pagePid} onChange={(e) => setPagePid(e.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-line bg-white px-3 font-normal">
                {channels.length === 0 && <option value="">Chưa bật kênh Zalo (Smax) nào</option>}
                {channels.map((c) => <option key={c.page_pid} value={c.page_pid} disabled={!!c.connection_error}>{c.name}{c.is_default ? " (mặc định)" : ""}{c.connection_error ? " — mất kết nối" : ""}</option>)}
              </select>
            </label>
            <label className="block font-semibold text-text-secondary">Số tin nhắn / phút
              <input type="number" min={1} max={120} value={rate} onChange={(e) => setRate(Math.max(1, Math.min(120, parseInt(e.target.value, 10) || 60)))}
                className="mt-1 min-h-10 w-full rounded-md border border-line px-3 font-normal" />
            </label>
            {msgCount > 0 && <p className="text-xs text-muted">{msgCount} tin/khách · khoảng {minutes} phút cho {uniquePhones} khách. Gửi cho mọi khách có Zalo (kể cả chưa kết bạn) — khách chặn tin người lạ sẽ báo thất bại.</p>}
          </div>
        </div>}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
        {delivery ? <button type="button" onClick={onClose} className="min-h-10 rounded-md border border-line px-4 font-semibold">Đóng</button> : confirming ? <>
          <span className="mr-auto text-sm font-semibold text-ink">Gửi “{preview?.name}” cho {uniquePhones} khách qua {channels.find((c) => c.page_pid === pagePid)?.name}?</span>
          <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="min-h-10 rounded-md border border-line px-4 font-semibold">Quay lại</button>
          <button type="button" onClick={() => void start()} disabled={busy} className="min-h-10 rounded-md bg-[#dd2746] px-4 font-bold text-white disabled:opacity-60">{busy ? "Đang tạo…" : "Xác nhận chạy broadcast"}</button>
        </> : <>
          <button type="button" onClick={onClose} className="min-h-10 rounded-md border border-line px-4 font-semibold">Huỷ</button>
          <button type="button" disabled={!blockId || !preview?.messages?.length || !pagePid || uniquePhones === 0} onClick={() => setConfirming(true)}
            className="min-h-10 rounded-md bg-brand px-4 font-bold text-brand-teal disabled:opacity-40">Tiếp tục</button>
        </>}
      </div>
    </div>
  </div>;
}
