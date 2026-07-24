"use client";

import { useState } from "react";
import { refreshZaloDeliveryItem, retryZaloDeliveryItem } from "@/lib/api";
import type { ZaloDelivery, ZaloMessageBlock } from "@/types/zalo-message";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Không rõ lỗi";
}

function date(value?: string | null) {
  return value ? new Date(value).toLocaleString("vi-VN") : "—";
}

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

export default function ZaloDeliveryModal({ delivery, onClose, onChanged, canSend }: { delivery: ZaloDelivery; onClose: () => void; onChanged: () => void; canSend: boolean }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const action = async (itemId: string, kind: "refresh" | "retry") => {
    setBusy(itemId + kind);
    setError("");
    try {
      if (kind === "refresh") await refreshZaloDeliveryItem(itemId);
      else await retryZaloDeliveryItem(itemId);
      onChanged();
    } catch (actionError) {
      setError(errorText(actionError));
    } finally {
      setBusy("");
    }
  };
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Chi tiết gửi tin Zalo">
    <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl">
      <div className="flex items-start justify-between gap-3"><div><h3 className="font-heading text-lg font-bold text-ink">{delivery.template_name}</h3><p className="text-xs text-muted">{date(delivery.created_at)} · {delivery.status}</p></div><button type="button" onClick={onClose} className="text-2xl text-muted" aria-label="Đóng">×</button></div>
      {error && <div className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-error">{error}</div>}
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm"><div className="rounded border border-line p-2"><strong>{delivery.recipient_count}</strong><div className="text-xs text-muted">Người nhận</div></div><div className="rounded border border-line p-2"><strong>{delivery.sent_count}</strong><div className="text-xs text-muted">Đã gửi</div></div><div className="rounded border border-line p-2"><strong>{delivery.failed_count}</strong><div className="text-xs text-muted">Lỗi</div></div></div>
      <div className="mt-4"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Nội dung đã gửi</div><Preview blocks={snapshotBlocks(delivery.content_blocks)} /></div>
      <div className="mt-4 space-y-2">{delivery.items.map((item) => <div key={item.id} className="rounded border border-line p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold text-ink">{item.recipient_name || item.phone || item.guest_id || "Người nhận"}</div><span className={item.status === "failed" ? "text-red-600" : "text-muted"}>{item.status}</span></div><div className="mt-1 text-xs text-muted">Block {(item.block_position ?? 0) + 1} · Thử {item.attempt_count} lần · {date(item.sent_at || item.updated_at)}</div><div className="mt-1 break-all text-xs text-muted">Recipient: {item.recipient_id || "—"}{item.phone ? ` · ${item.phone}` : ""}</div>{item.message_ids.length > 0 && <div className="mt-1 break-all text-xs text-muted">Message ID: {item.message_ids.join(", ")}</div>}{item.last_error && <div className="mt-2 text-xs text-red-600">{item.last_error}</div>}{item.provider_response && <details className="mt-2 text-xs"><summary className="cursor-pointer font-semibold text-muted">Provider response</summary><pre className="mt-1 overflow-x-auto rounded bg-surface-muted p-2 text-[11px] text-ink">{JSON.stringify(item.provider_response, null, 2)}</pre></details>}{canSend && item.status === "failed" && <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={!!busy} onClick={() => void action(item.id, "refresh")} className="min-h-8 rounded border border-brand px-3 text-xs font-semibold text-brand">{busy === item.id + "refresh" ? "Đang refresh..." : "Refresh recipient"}</button><button type="button" disabled={!!busy || !item.recipient_id} onClick={() => void action(item.id, "retry")} className="min-h-8 rounded bg-brand px-3 text-xs font-semibold text-brand-teal disabled:opacity-40">{busy === item.id + "retry" ? "Đang retry..." : "Gửi lại block này"}</button></div>}</div>)}</div>
    </div>
  </div>;
}
