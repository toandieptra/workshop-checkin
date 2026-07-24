"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  cloneZaloMessageTemplate,
  createZaloMessageTemplate,
  deleteZaloMessageTemplate,
  getZaloMessageQuota,
  getZaloDelivery,
  getZaloTemplateVariables,
  listZaloDeliveries,
  listZaloMessageTemplates,
  preflightZaloBulkMessage,
  sendZaloBulkMessage,
  toggleZaloMessageTemplate,
  updateZaloMessageTemplate,
  uploadZaloMessageMedia,
} from "@/lib/api";
import { PERMISSIONS } from "@/lib/permissions";
import { useAuth } from "@/contexts/AuthContext";
import ZaloDeliveryModal from "@/components/ZaloDeliveryModal";
import type { Guest, Workshop } from "@/hooks/useAdminGuests";
import type {
  ZaloBulkPreflight,
  ZaloBulkSendResult,
  ZaloDelivery,
  ZaloMessageBlock,
  ZaloMessageBlockType,
  ZaloMessageQuota,
  ZaloMessageTemplate,
  ZaloMessageTemplateInput,
  ZaloMessageTemplateStatus,
  ZaloTemplateVariable,
} from "@/types/zalo-message";

const PAGE_SIZE = 20;
const MAX_MEDIA_COUNT = 10;
const MAX_MEDIA_FILE_SIZE = 50 * 1024 * 1024;
const EMPTY_QUOTA: ZaloMessageQuota = {
  used: 0,
  limit: 0,
  remaining: 0,
  resets_at: null,
};
const STATUS_OPTIONS: Array<{
  value: ZaloMessageTemplateStatus | "";
  label: string;
}> = [
  { value: "", label: "Tất cả trạng thái" },
  { value: "active", label: "Đang sử dụng" },
  { value: "draft", label: "Bản nháp" },
  { value: "archived", label: "Đã lưu trữ" },
];
const STATUS_META: Record<
  ZaloMessageTemplateStatus,
  { label: string; className: string }
> = {
  active: { label: "Đang sử dụng", className: "bg-green-50 text-green-700" },
  draft: { label: "Bản nháp", className: "bg-amber-50 text-amber-700" },
  archived: { label: "Đã lưu trữ", className: "bg-gray-100 text-gray-600" },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Không rõ lỗi";
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}

function blockId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `block-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptyBlock(type: ZaloMessageBlockType): ZaloMessageBlock {
  return {
    id: blockId(),
    type,
    ...(type === "text" ? { text: "" } : type === "image" ? { images: [] } : { url: "" }),
  };
}

function albumImages(block: ZaloMessageBlock) {
  return block.images?.length ? block.images : block.url ? [{ id: `${block.id}-legacy`, url: block.url }] : [];
}

function mediaCount(blocks: ZaloMessageBlock[]) {
  return blocks.reduce((count, block) => count + (block.type === "image" ? albumImages(block).length : block.type === "video" ? 1 : 0), 0);
}

function AlbumGrid({ block, editable = false, onRemove, onMove }: {
  block: ZaloMessageBlock;
  editable?: boolean;
  onRemove?: (imageId: string) => void;
  onMove?: (imageIndex: number, offset: number) => void;
}) {
  const images = albumImages(block);
  if (!images.length) return <div className="grid h-32 place-items-center bg-surface-muted text-xs text-muted">Ảnh sẽ hiển thị tại đây</div>;
  return <div className={`grid gap-1 overflow-hidden ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
    {images.map((image, index) => <div key={image.id} className="group relative aspect-square overflow-hidden bg-surface-muted">
      <img src={image.url} alt={`Ảnh ${index + 1} trong album`} className="h-full w-full object-cover" />
      {editable && <div className="absolute inset-x-1 bottom-1 flex justify-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
        <button type="button" disabled={index === 0} onClick={() => onMove?.(index, -1)} className="grid h-7 w-7 place-items-center rounded bg-white/95 text-xs shadow disabled:opacity-40" aria-label="Đưa ảnh sang trái">←</button>
        <button type="button" onClick={() => onRemove?.(image.id)} className="grid h-7 w-7 place-items-center rounded bg-white/95 text-red-600 shadow" aria-label="Xóa ảnh">×</button>
        <button type="button" disabled={index === images.length - 1} onClick={() => onMove?.(index, 1)} className="grid h-7 w-7 place-items-center rounded bg-white/95 text-xs shadow disabled:opacity-40" aria-label="Đưa ảnh sang phải">→</button>
      </div>}
    </div>)}
  </div>;
}

function ZaloPreview({
  template,
}: {
  template: Pick<ZaloMessageTemplateInput, "name" | "blocks">;
}) {
  return (
    <div className="mx-auto w-full max-w-[340px] rounded-[28px] border-[7px] border-[#173b42] bg-[#e9f5f7] p-3 shadow-lg">
      <div className="mb-3 flex items-center gap-2 border-b border-white/80 pb-3">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-[#0068ff] text-sm font-bold text-white">
          Z
        </div>
        <div>
          <div className="text-sm font-bold text-ink">Workshop Check-in</div>
          <div className="text-[11px] text-muted">Tin nhắn Zalo</div>
        </div>
      </div>
      <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
        {!template.blocks.length && (
          <div className="rounded-xl bg-white p-4 text-center text-xs text-muted">
            Thêm block để xem trước tin nhắn.
          </div>
        )}
        {template.blocks.map((block) => (
          <div
            key={block.id}
            className="overflow-hidden rounded-xl rounded-tl-sm bg-white shadow-sm"
          >
            {block.type === "text" && (
              <div className="whitespace-pre-wrap break-words px-3 py-2.5 text-sm text-ink">
                {block.text || "Nội dung văn bản..."}
              </div>
            )}
            {block.type === "image" && <AlbumGrid block={block as ZaloMessageBlock} />}
            {block.type === "video" && (
              <div className="relative grid min-h-36 place-items-center bg-[#173b42]">
                {block.thumbnail_url ? (
                  <img
                    src={block.thumbnail_url}
                    alt="Thumbnail video"
                    className="absolute inset-0 h-full w-full object-cover opacity-80"
                  />
                ) : null}
                <span className="relative grid h-12 w-12 place-items-center rounded-full bg-white/90 pl-1 text-xl text-brand-teal">
                  ▶
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mx-auto mt-4 h-1 w-24 rounded-full bg-[#173b42]/30" />
    </div>
  );
}

function TemplateDeliveryHistory({ template, canSend, onClose }: { template: ZaloMessageTemplate; canSend: boolean; onClose: () => void }) {
  const [deliveries, setDeliveries] = useState<ZaloDelivery[]>([]);
  const [detail, setDetail] = useState<ZaloDelivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDeliveries(await listZaloDeliveries(undefined, 0, 100, template.id));
    } catch (loadError) {
      setError("Không tải được lịch sử gửi: " + errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [template.id]);

  useEffect(() => { void load(); }, [load]);

  const refreshDetail = async () => {
    if (!detail) return;
    try {
      setDetail(await getZaloDelivery(detail.id));
      await load();
    } catch (refreshError) {
      setError("Không tải được chi tiết delivery: " + errorMessage(refreshError));
    }
  };

  return <>
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Lịch sử gửi ${template.name}`}>
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl">
        <div className="flex items-start justify-between gap-3"><div><h3 className="font-heading text-lg font-bold text-ink">Lịch sử gửi</h3><p className="mt-1 text-sm text-muted">{template.name}</p></div><button type="button" onClick={onClose} className="text-2xl text-muted" aria-label="Đóng">×</button></div>
        <div className="mt-4 flex items-center justify-between gap-3"><div className="text-sm text-muted">{deliveries.length} delivery gần nhất</div><button type="button" onClick={() => void load()} disabled={loading} className="min-h-9 rounded border border-line px-3 text-xs font-semibold text-brand-teal">{loading ? "Đang tải..." : "Làm mới"}</button></div>
        {error && <div className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-error">{error}</div>}
        {!loading && !deliveries.length && <div className="mt-4 rounded border border-dashed border-line p-8 text-center text-sm text-muted">Mẫu tin này chưa có delivery.</div>}
        <div className="mt-4 space-y-2">{deliveries.map((delivery) => <button type="button" key={delivery.id} onClick={() => void getZaloDelivery(delivery.id).then(setDetail).catch((detailError) => setError("Không tải được chi tiết delivery: " + errorMessage(detailError)))} className="block w-full rounded border border-line p-3 text-left hover:bg-brand/5"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-ink">{formatDateTime(delivery.created_at)}</strong><span className={`text-sm font-semibold ${delivery.failed_count ? "text-red-600" : "text-muted"}`}>{delivery.status}</span></div><div className="mt-1 text-xs text-muted">{delivery.recipient_count} người nhận · {delivery.sent_count} đã gửi · {delivery.failed_count} lỗi · Xem chi tiết</div></button>)}</div>
      </div>
    </div>
    {detail && <ZaloDeliveryModal delivery={detail} canSend={canSend} onClose={() => setDetail(null)} onChanged={() => void refreshDetail()} />}
  </>;
}

function BlockEditor({
  blocks,
  onChange,
}: {
  blocks: ZaloMessageBlock[];
  onChange: (blocks: ZaloMessageBlock[]) => void;
}) {
  const [uploadingId, setUploadingId] = useState("");
  const [uploadProgress, setUploadProgress] = useState("");
  const [mediaError, setMediaError] = useState<Record<string, string>>({});
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [variables, setVariables] = useState<ZaloTemplateVariable[]>([]);
  const [variableBlockId, setVariableBlockId] = useState("");
  const [variableSearch, setVariableSearch] = useState("");
  const [draggedId, setDraggedId] = useState("");
  const textareas = useRef<Record<string, HTMLTextAreaElement | null>>({});

  useEffect(() => { void getZaloTemplateVariables().then(setVariables); }, []);

  const patch = (id: string, values: Partial<ZaloMessageBlock>) =>
    onChange(
      blocks.map((block) =>
        block.id === id ? { ...block, ...values } : block,
      ),
    );
  const move = (index: number, offset: number) => {
    const destination = index + offset;
    if (destination < 0 || destination >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[destination]] = [next[destination], next[index]];
    onChange(next);
  };
  const moveBefore = (sourceId: string, targetId: string) => {
    if (!sourceId || sourceId === targetId) return;
    const next = [...blocks];
    const sourceIndex = next.findIndex((block) => block.id === sourceId);
    const targetIndex = next.findIndex((block) => block.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [source] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, source);
    onChange(next);
  };
  const uploadVideo = async (block: ZaloMessageBlock, file?: File) => {
    if (!file || block.type !== "video") return;
    if (file.size > MAX_MEDIA_FILE_SIZE) {
      setMediaError((current) => ({ ...current, [block.id]: `${file.name}: vượt giới hạn 50MB/file.` }));
      return;
    }
    setUploadingId(block.id);
    setUploadProgress("Đang tải video...");
    setMediaError((current) => ({ ...current, [block.id]: "" }));
    try {
      const result = await uploadZaloMessageMedia(file, "video");
      patch(block.id, {
        url: result.url,
        thumbnail_url: result.thumbnail_url || undefined,
      });
    } catch (error) {
      setMediaError((current) => ({ ...current, [block.id]: "Tải video thất bại: " + errorMessage(error) }));
    } finally {
      setUploadingId("");
      setUploadProgress("");
    }
  };
  const uploadImages = async (block: ZaloMessageBlock, files?: FileList | null) => {
    if (!files?.length || block.type !== "image") return;
    const selected = Array.from(files);
    const oversized = selected.find((file) => file.size > MAX_MEDIA_FILE_SIZE);
    if (oversized) {
      setMediaError((current) => ({ ...current, [block.id]: `${oversized.name}: vượt giới hạn 50MB/file.` }));
      return;
    }
    const remaining = MAX_MEDIA_COUNT - mediaCount(blocks);
    if (remaining <= 0 || selected.length > remaining) {
      setMediaError((current) => ({ ...current, [block.id]: `Chỉ có thể thêm ${Math.max(remaining, 0)} ảnh; toàn template tối đa 10 media.` }));
      return;
    }
    setUploadingId(block.id);
    setMediaError((current) => ({ ...current, [block.id]: "" }));
    let images = albumImages(block);
    for (let index = 0; index < selected.length; index += 1) {
      const file = selected[index];
      setUploadProgress(`Đang tải ảnh ${index + 1}/${selected.length}: ${file.name}`);
      try {
        const result = await uploadZaloMessageMedia(file, "image");
        images = [...images, { id: blockId(), url: result.url }];
        onChange(blocks.map((item) => item.id === block.id ? { ...item, images, url: undefined } : item));
      } catch (error) {
        setMediaError((current) => ({ ...current, [block.id]: `Ảnh ${index + 1}/${selected.length} (${file.name}) thất bại: ${errorMessage(error)}. ${images.length - albumImages(block).length} ảnh trước đó đã được thêm.` }));
        break;
      }
    }
    setUploadingId("");
    setUploadProgress("");
  };
  const uploadThumbnail = async (block: ZaloMessageBlock, file?: File) => {
    if (!file || block.type !== "video") return;
    if (file.size > MAX_MEDIA_FILE_SIZE) {
      setMediaError((current) => ({ ...current, [block.id]: `${file.name}: vượt giới hạn 50MB/file.` }));
      return;
    }
    setUploadingId(`${block.id}-thumbnail`);
    try {
      const result = await uploadZaloMessageMedia(file, "thumbnail");
      patch(block.id, { thumbnail_url: result.url });
    } catch (error) {
      setMediaError((current) => ({ ...current, [block.id]: "Tải thumbnail thất bại: " + errorMessage(error) }));
    } finally {
      setUploadingId("");
    }
  };
  const addImageUrl = (block: ZaloMessageBlock) => {
    const url = (imageUrls[block.id] || "").trim();
    if (!url) return;
    if (mediaCount(blocks) >= MAX_MEDIA_COUNT) {
      setMediaError((current) => ({ ...current, [block.id]: "Template đã đạt giới hạn 10 media." }));
      return;
    }
    patch(block.id, { images: [...albumImages(block), { id: blockId(), url }], url: undefined });
    setImageUrls((current) => ({ ...current, [block.id]: "" }));
    setMediaError((current) => ({ ...current, [block.id]: "" }));
  };
  const insertVariable = (block: ZaloMessageBlock, variable: string) => {
    const textarea = textareas.current[block.id];
    const text = block.text || "";
    const start = textarea?.selectionStart ?? text.length;
    const end = textarea?.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${variable}${text.slice(end)}`.slice(0, 2000);
    patch(block.id, { text: next });
    setVariableBlockId("");
    requestAnimationFrame(() => {
      textarea?.focus();
      const cursor = Math.min(start + variable.length, next.length);
      textarea?.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div>
      <div className="space-y-3">
        {blocks.map((block, index) => (
          <article
            key={block.id}
            draggable
            onDragStart={() => setDraggedId(block.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              moveBefore(draggedId, block.id);
              setDraggedId("");
            }}
            className={`rounded-lg border bg-white p-3 transition ${draggedId === block.id ? "border-brand opacity-60" : "border-line"}`}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="cursor-grab text-lg text-muted"
                  title="Kéo để sắp xếp"
                >
                  ⠿
                </span>
                <span className="truncate text-sm font-bold text-ink">
                  {index + 1}.{" "}
                  {block.type === "text"
                    ? "Văn bản"
                    : block.type === "image"
                      ? "Hình ảnh"
                      : "Video"}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="grid h-8 w-8 place-items-center rounded border border-line disabled:opacity-30"
                  aria-label="Đưa block lên"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={index === blocks.length - 1}
                  onClick={() => move(index, 1)}
                  className="grid h-8 w-8 place-items-center rounded border border-line disabled:opacity-30"
                  aria-label="Đưa block xuống"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChange(blocks.filter((item) => item.id !== block.id))
                  }
                  className="grid h-8 w-8 place-items-center rounded border border-red-200 text-red-600"
                  aria-label="Xóa block"
                >
                  ×
                </button>
              </div>
            </div>
            {block.type === "text" ? (
              <div className="relative space-y-1.5">
              <textarea
                ref={(element) => { textareas.current[block.id] = element; }}
                value={block.text || ""}
                onChange={(event) =>
                  patch(block.id, { text: event.target.value })
                }
                rows={4}
                maxLength={2000}
                placeholder="Nhập nội dung tin nhắn. Có thể dùng biến như {{full_name}}..."
                className="w-full rounded-md border border-line p-3 text-sm outline-none focus:border-brand"
              />
              <div className="flex items-center justify-between gap-2 text-xs text-muted">
                <span>{(block.text || "").length}/2000 ký tự</span>
                <button type="button" onClick={() => { setVariableBlockId(variableBlockId === block.id ? "" : block.id); setVariableSearch(""); }} className="rounded-full border border-brand px-3 py-1.5 font-semibold text-brand">Chèn biến <span className="ml-1 rounded-full bg-brand/10 px-1.5">{variables.length}</span></button>
              </div>
              {variableBlockId === block.id && <div className="absolute right-0 z-20 mt-1 w-full max-w-sm rounded-lg border border-line bg-white p-3 shadow-xl">
                <input autoFocus value={variableSearch} onChange={(event) => setVariableSearch(event.target.value)} placeholder="Tìm biến..." className="min-h-9 w-full rounded border border-line px-3 text-sm outline-none focus:border-brand" />
                <div className="mt-2 max-h-64 overflow-y-auto">
                  {(["Guest", "Workshop"] as const).map((group) => {
                    const term = variableSearch.trim().toLocaleLowerCase("vi");
                    const items = variables.filter((variable) => variable.group === group && `${variable.label} ${variable.key} ${variable.description || ""}`.toLocaleLowerCase("vi").includes(term));
                    return items.length ? <div key={group} className="mb-2"><div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted">{group}</div>{items.map((variable) => <div key={variable.key} className="flex items-center gap-1 rounded hover:bg-brand/5"><button type="button" onClick={() => insertVariable(block, variable.key)} className="min-w-0 flex-1 px-2 py-2 text-left"><span className="block truncate text-xs font-semibold text-ink">{variable.label}</span><code className="text-[11px] text-brand">{variable.key}</code></button><button type="button" onClick={() => void navigator.clipboard?.writeText(variable.key)} className="mr-1 rounded border border-line px-2 py-1 text-[10px]" aria-label={`Sao chép ${variable.key}`}>Copy</button></div>)}</div> : null;
                  })}
                </div>
              </div>}
              </div>
            ) : (
              <div className="space-y-3">
                {block.type === "image" ? <>
                  <AlbumGrid block={block} editable onRemove={(imageId) => patch(block.id, { images: albumImages(block).filter((image) => image.id !== imageId), url: undefined })} onMove={(imageIndex, offset) => { const images = [...albumImages(block)]; const target = imageIndex + offset; if (target < 0 || target >= images.length) return; [images[imageIndex], images[target]] = [images[target], images[imageIndex]]; patch(block.id, { images, url: undefined }); }} />
                  <div className="flex gap-2"><input type="url" value={imageUrls[block.id] || ""} onChange={(event) => setImageUrls((current) => ({ ...current, [block.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addImageUrl(block); } }} placeholder="https://... thêm ảnh vào album" className="min-h-10 min-w-0 flex-1 rounded-md border border-line px-3 text-sm outline-none focus:border-brand" /><button type="button" onClick={() => addImageUrl(block)} className="rounded-md border border-brand px-3 text-xs font-semibold text-brand">Thêm URL</button></div>
                  <label className="inline-flex cursor-pointer rounded-md border border-brand px-3 py-2 text-xs font-semibold text-brand hover:bg-brand/5">
                    {uploadingId === block.id ? uploadProgress || "Đang tải..." : "Tải nhiều ảnh lên"}
                    <input type="file" multiple disabled={!!uploadingId} accept="image/*" onChange={(event) => { void uploadImages(block, event.target.files); event.target.value = ""; }} className="sr-only" />
                  </label>
                  <div className="text-xs text-muted">{albumImages(block).length} ảnh trong album · 50MB/file · {mediaCount(blocks)}/{MAX_MEDIA_COUNT} media/template</div>
                </> : <label className="block text-xs font-semibold text-text-secondary">
                  URL video
                  <input
                    type="url"
                    value={block.url || ""}
                    onChange={(event) =>
                      patch(block.id, { url: event.target.value })
                    }
                    placeholder="https://..."
                    className="mt-1 min-h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-brand"
                  />
                </label>}
                {block.type === "video" && <div className="flex items-center gap-3">
                  <span className="text-xs text-muted">hoặc</span>
                  <label className="cursor-pointer rounded-md border border-brand px-3 py-2 text-xs font-semibold text-brand hover:bg-brand/5">
                    {uploadingId === block.id ? "Đang tải..." : "Tải file lên"}
                    <input
                      type="file"
                      disabled={uploadingId === block.id}
                      accept="video/*"
                      onChange={(event) =>
                        void uploadVideo(block, event.target.files?.[0])
                      }
                      className="sr-only"
                    />
                  </label>
                </div>}
                {block.type === "video" && <div className="text-xs text-muted">50MB/file · {mediaCount(blocks)}/{MAX_MEDIA_COUNT} media/template</div>}
                {block.type === "video" && (
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-text-secondary">
                      URL thumbnail
                      <input
                        type="url"
                        value={block.thumbnail_url || ""}
                        onChange={(event) =>
                          patch(block.id, { thumbnail_url: event.target.value })
                        }
                        placeholder="https://... hoặc tải thumbnail lên"
                        className="mt-1 min-h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-brand"
                      />
                    </label>
                    <label className="inline-flex cursor-pointer rounded-md border border-brand px-3 py-2 text-xs font-semibold text-brand hover:bg-brand/5">
                      {uploadingId === `${block.id}-thumbnail`
                        ? "Đang tải thumbnail..."
                        : "Tải thumbnail lên"}
                      <input
                        type="file"
                        disabled={!!uploadingId}
                        accept="image/*"
                        onChange={(event) =>
                          void uploadThumbnail(block, event.target.files?.[0])
                        }
                        className="sr-only"
                      />
                    </label>
                  </div>
                )}
                {mediaError[block.id] && <div role="alert" className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{mediaError[block.id]}</div>}
              </div>
            )}
          </article>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {(["text", "image", "video"] as ZaloMessageBlockType[]).map((type) => (
          <button
            key={type}
            type="button"
            disabled={type !== "text" && mediaCount(blocks) >= MAX_MEDIA_COUNT}
            onClick={() => onChange([...blocks, emptyBlock(type)])}
            className="min-h-10 rounded-md border border-dashed border-brand px-2 text-xs font-semibold text-brand hover:bg-brand/5 disabled:opacity-40"
          >
            +{" "}
            {type === "text"
              ? "Văn bản"
              : type === "image"
                ? "Hình ảnh"
                : "Video"}
          </button>
        ))}
      </div>
    </div>
  );
}

function TemplateEditor({
  template,
  saving,
  readOnly,
  onClose,
  onSave,
}: {
  template: ZaloMessageTemplate | null;
  saving: boolean;
  readOnly: boolean;
  onClose: () => void;
  onSave: (input: ZaloMessageTemplateInput) => void;
}) {
  const [draft, setDraft] = useState<ZaloMessageTemplateInput>(() =>
    template
      ? {
          name: template.name,
          description: template.description || "",
          status: template.status,
          blocks: template.blocks.map((block) => ({
            ...block,
            id: block.id || blockId(),
          })),
        }
      : {
          name: "",
          description: "",
          status: "draft",
          blocks: [emptyBlock("text")],
        },
  );
  const valid =
    draft.name.trim() &&
    draft.blocks.length &&
    mediaCount(draft.blocks as ZaloMessageBlock[]) <= MAX_MEDIA_COUNT &&
    draft.blocks.every((block) =>
      block.type === "text"
        ? block.text?.trim()
        : block.type === "video"
          ? block.url?.trim() && block.thumbnail_url?.trim()
          : albumImages(block as ZaloMessageBlock).some((image) => image.url.trim()),
    );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={template ? "Sửa mẫu tin" : "Tạo mẫu tin"}
    >
      <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden bg-[#f8fbfb] shadow-xl sm:h-[calc(100vh-2rem)] sm:rounded-xl">
        <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3 sm:px-6">
          <div>
            <h2 className="font-heading text-lg font-bold text-ink">
              {readOnly
                ? "Xem mẫu tin Zalo"
                : template
                  ? "Sửa mẫu tin Zalo"
                  : "Tạo mẫu tin Zalo"}
            </h2>
            <p className="text-xs text-muted">
              Thiết kế nội dung theo từng block và xem trước ngay lập tức.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full text-2xl text-muted hover:bg-surface-muted"
            aria-label="Đóng"
          >
            ×
          </button>
        </header>
        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_390px] lg:overflow-hidden">
          <fieldset
            disabled={readOnly}
            className="space-y-5 p-4 disabled:opacity-80 lg:overflow-y-auto lg:p-6"
          >
            <div className="grid gap-4 sm:grid-cols-[1fr_190px]">
              <label className="block text-sm font-semibold text-text-secondary">
                Tên mẫu tin *
                <input
                  autoFocus
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                  className="mt-1 min-h-10 w-full rounded-md border border-line px-3 font-normal outline-none focus:border-brand"
                />
              </label>
              <label className="block text-sm font-semibold text-text-secondary">
                Trạng thái
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      status: event.target.value as ZaloMessageTemplateStatus,
                    })
                  }
                  className="mt-1 min-h-10 w-full rounded-md border border-line bg-white px-3 font-normal outline-none focus:border-brand"
                >
                  <option value="draft">Bản nháp</option>
                  <option value="active">Đang sử dụng</option>
                  <option value="archived">Đã lưu trữ</option>
                </select>
              </label>
            </div>
            <label className="block text-sm font-semibold text-text-secondary">
              Mô tả
              <input
                value={draft.description || ""}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                className="mt-1 min-h-10 w-full rounded-md border border-line px-3 font-normal outline-none focus:border-brand"
              />
            </label>
            <section>
              <div className="mb-3">
                <h3 className="font-heading font-bold text-ink">
                  Nội dung tin nhắn
                </h3>
                <p className="text-xs text-muted">
                  Kéo thả hoặc dùng nút lên/xuống để đổi thứ tự block. Giới hạn: 50MB/file, 10 media/template, 2000 ký tự/text.
                </p>
              </div>
              <BlockEditor
                blocks={draft.blocks as ZaloMessageBlock[]}
                onChange={(blocks) => setDraft({ ...draft, blocks })}
              />
            </section>
          </fieldset>
          <aside className="border-t border-line bg-[#eaf4f5] p-5 lg:overflow-y-auto lg:border-l lg:border-t-0">
            <div className="mb-4 text-center text-xs font-bold uppercase tracking-[0.14em] text-brand-teal">
              Xem trước trên Zalo
            </div>
            <ZaloPreview template={draft} />
          </aside>
        </div>
        <footer className="flex justify-end gap-2 border-t border-line bg-white px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-md border border-line px-4 text-sm font-semibold"
          >
            {readOnly ? "Đóng" : "Hủy"}
          </button>
          {!readOnly && (
            <button
              type="button"
              disabled={!valid || saving}
              onClick={() =>
                onSave({
                  ...draft,
                  name: draft.name.trim(),
                  description: draft.description?.trim(),
                })
              }
              className="min-h-10 rounded-md bg-brand px-5 text-sm font-semibold text-brand-teal disabled:opacity-40"
            >
              {saving ? "Đang lưu..." : "Lưu mẫu tin"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function BulkSendModal({
  templates,
  onClose,
  onSent,
}: {
  templates: ZaloMessageTemplate[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [templateId, setTemplateId] = useState(
    templates.find((template) => template.status === "active")?.id || "",
  );
  const [workshopId, setWorkshopId] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [preflight, setPreflight] = useState<ZaloBulkPreflight | null>(null);
  const [result, setResult] = useState<ZaloBulkSendResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void api<Workshop[]>("/workshops")
      .then((data) => {
        setWorkshops(data);
        setWorkshopId(data[0]?.id || "");
      })
      .catch((loadError) =>
        setError("Không tải được workshop: " + errorMessage(loadError)),
      )
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!workshopId) {
      setGuests([]);
      return;
    }
    setLoading(true);
    setPreflight(null);
    setSelected([]);
    void api<Guest[]>(
      `/workshops/${encodeURIComponent(workshopId)}/guests?sort_registered_at=desc`,
    )
      .then(setGuests)
      .catch((loadError) =>
        setError("Không tải được khách: " + errorMessage(loadError)),
      )
      .finally(() => setLoading(false));
  }, [workshopId]);

  const filtered = guests.filter((guest) =>
    `${guest.full_name} ${guest.phone || ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const selectedSet = new Set(selected);
  const eligibleCount = preflight?.eligible_count || 0;
  const runPreflight = async () => {
    setSubmitting(true);
    setError("");
    try {
      setPreflight(
        await preflightZaloBulkMessage({
          template_id: templateId,
          workshop_id: workshopId,
          guest_ids: selected,
        }),
      );
    } catch (preflightError) {
      setError(
        "Kiểm tra trước khi gửi thất bại: " + errorMessage(preflightError),
      );
    } finally {
      setSubmitting(false);
    }
  };
  const send = async () => {
    if (
      !preflight ||
      !window.confirm(
        `Xác nhận xếp hàng gửi mẫu tin cho ${selected.length} khách đã chọn?`,
      )
    )
      return;
    setSubmitting(true);
    setError("");
    try {
      setResult(
        await sendZaloBulkMessage({
          template_id: templateId,
          guest_ids: selected,
        }),
      );
      onSent();
    } catch (sendError) {
      setError("Gửi tin thất bại: " + errorMessage(sendError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Gửi tin Zalo hàng loạt"
    >
      <div className="flex max-h-[95vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-xl bg-white shadow-xl sm:rounded-xl">
        <header className="flex items-center justify-between border-b border-line px-4 py-4 sm:px-5">
          <div>
            <h2 className="font-heading text-lg font-bold text-ink">
              Gửi tin Zalo hàng loạt
            </h2>
            <p className="text-xs text-muted">
              Chọn khách, kiểm tra điều kiện, xác nhận và theo dõi kết quả.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full text-2xl text-muted hover:bg-surface-muted"
            aria-label="Đóng"
          >
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-error">
              {error}
            </div>
          )}
          {result ? (
            <div className="space-y-5">
              <div className="rounded-lg border border-success-border bg-success-soft p-5">
                <h3 className="font-heading text-xl font-bold text-success">
                  Đã xếp hàng gửi tin
                </h3>
                <p className="mt-1 text-sm text-success">
                  Delivery ID:{" "}
                  <span className="font-mono">{result.batch_id}</span> · Trạng
                  thái: {result.status}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Tổng", result.total],
                  ["Đã gửi", result.sent],
                  ["Lỗi", result.failed],
                  ["Bỏ qua", result.skipped],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-md border border-line p-4 text-center"
                  >
                    <div className="text-2xl font-bold text-ink">{value}</div>
                    <div className="text-xs text-muted">{label}</div>
                  </div>
                ))}
              </div>
              {!!result.results?.length && (
                <div className="overflow-hidden rounded-md border border-line">
                  <div className="max-h-72 overflow-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead className="sticky top-0 bg-surface-muted text-left text-xs text-muted">
                        <tr>
                          <th className="px-3 py-2">Khách</th>
                          <th className="px-3 py-2">Trạng thái</th>
                          <th className="px-3 py-2">Chi tiết</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {result.results.map((item) => (
                          <tr key={item.guest_id}>
                            <td className="px-3 py-2 font-medium">
                              {item.full_name || item.guest_id}
                            </td>
                            <td className="px-3 py-2">{item.status}</td>
                            <td className="px-3 py-2 text-red-600">
                              {item.error || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-semibold text-text-secondary">
                  Mẫu tin
                  <select
                    value={templateId}
                    onChange={(event) => {
                      setTemplateId(event.target.value);
                      setPreflight(null);
                    }}
                    className="mt-1 min-h-10 w-full rounded-md border border-line bg-white px-3 font-normal outline-none focus:border-brand"
                  >
                    <option value="">Chọn mẫu đang sử dụng</option>
                    {templates
                      .filter((template) => template.status === "active")
                      .map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-text-secondary">
                  Workshop
                  <select
                    value={workshopId}
                    onChange={(event) => setWorkshopId(event.target.value)}
                    className="mt-1 min-h-10 w-full rounded-md border border-line bg-white px-3 font-normal outline-none focus:border-brand"
                  >
                    <option value="">Chọn workshop</option>
                    {workshops.map((workshop) => (
                      <option key={workshop.id} value={workshop.id}>
                        {workshop.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-5 overflow-hidden rounded-lg border border-line">
                <div className="flex flex-col gap-3 border-b border-line bg-surface-muted p-3 sm:flex-row sm:items-center sm:justify-between">
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Tìm tên hoặc số điện thoại"
                    className="min-h-10 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-brand sm:w-72"
                  />
                  <div className="text-xs text-muted">
                    Đã chọn{" "}
                    <strong className="text-ink">{selected.length}</strong>/
                    {guests.length} khách
                  </div>
                </div>
                <div className="max-h-72 overflow-auto">
                  <table className="w-full min-w-[600px] text-sm">
                    <thead className="sticky top-0 bg-white text-left text-xs text-muted">
                      <tr>
                        <th className="w-12 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={
                              !!filtered.length &&
                              filtered.every((guest) =>
                                selectedSet.has(guest.id),
                              )
                            }
                            onChange={(event) => {
                              setPreflight(null);
                              setSelected(
                                event.target.checked
                                  ? Array.from(
                                      new Set([
                                        ...selected,
                                        ...filtered.map((guest) => guest.id),
                                      ]),
                                    )
                                  : selected.filter(
                                      (id) =>
                                        !filtered.some(
                                          (guest) => guest.id === id,
                                        ),
                                    ),
                              );
                            }}
                            aria-label="Chọn tất cả khách đang hiển thị"
                          />
                        </th>
                        <th className="px-3 py-2">Khách</th>
                        <th className="px-3 py-2">Số điện thoại</th>
                        <th className="px-3 py-2">Điều kiện gửi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {loading ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="p-8 text-center text-muted"
                          >
                            Đang tải...
                          </td>
                        </tr>
                      ) : (
                        filtered.map((guest) => (
                          <tr
                            key={guest.id}
                            className={
                              selectedSet.has(guest.id) ? "bg-brand/5" : ""
                            }
                          >
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={selectedSet.has(guest.id)}
                                onChange={(event) => {
                                  setPreflight(null);
                                  setSelected(
                                    event.target.checked
                                      ? [...selected, guest.id]
                                      : selected.filter(
                                          (id) => id !== guest.id,
                                        ),
                                  );
                                }}
                              />
                            </td>
                            <td className="px-3 py-2 font-semibold text-ink">
                              {guest.full_name}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {guest.phone || "—"}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`text-xs font-semibold ${preflight ? "text-text-secondary" : "text-muted"}`}
                              >
                                {preflight
                                  ? "Xem tổng hợp bên dưới"
                                  : "Chưa kiểm tra"}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                      {!loading && !filtered.length && (
                        <tr>
                          <td
                            colSpan={4}
                            className="p-8 text-center text-muted"
                          >
                            Không có khách phù hợp.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              {preflight && (
                <div
                  className={`mt-4 rounded-md border p-4 ${preflight.can_send ? "border-success-border bg-success-soft" : "border-amber-200 bg-amber-50"}`}
                >
                  <div className="font-semibold text-ink">
                    Kết quả kiểm tra trước khi gửi
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <span>
                      Tổng: <strong>{preflight.total}</strong>
                    </span>
                    <span>
                      Đủ điều kiện: <strong>{preflight.eligible_count}</strong>
                    </span>
                    <span>
                      Không hợp lệ:{" "}
                      <strong>{preflight.ineligible_count}</strong>
                    </span>
                    <span>
                      Quota còn: <strong>{preflight.quota_remaining}</strong>
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-md border border-line px-4 text-sm font-semibold"
          >
            {result ? "Đóng" : "Hủy"}
          </button>
          {!result && !preflight && (
            <button
              type="button"
              disabled={
                !templateId || !workshopId || !selected.length || submitting
              }
              onClick={() => void runPreflight()}
              className="min-h-10 rounded-md bg-brand px-5 text-sm font-semibold text-brand-teal disabled:opacity-40"
            >
              {submitting ? "Đang kiểm tra..." : "Kiểm tra trước khi gửi"}
            </button>
          )}
          {!result && preflight && (
            <>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setPreflight(null)}
                className="min-h-10 rounded-md border border-brand px-4 text-sm font-semibold text-brand"
              >
                Chọn lại
              </button>
              <button
                type="button"
                disabled={
                  !preflight.can_send ||
                  !eligibleCount ||
                  selected.length > preflight.quota_remaining ||
                  submitting
                }
                onClick={() => void send()}
                className="min-h-10 rounded-md bg-brand px-5 text-sm font-semibold text-brand-teal disabled:opacity-40"
              >
                {submitting
                  ? "Đang gửi..."
                  : `Xác nhận xếp hàng ${selected.length} khách`}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

export default function ZaloMessageSettingsPanel() {
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.zaloTemplatesManage);
  const canReadDeliveries = can(PERMISSIONS.zaloMessagesView);
  const canSend = can(PERMISSIONS.zaloMessagesSend);
  const [templates, setTemplates] = useState<ZaloMessageTemplate[]>([]);
  const [quota, setQuota] = useState<ZaloMessageQuota>(EMPTY_QUOTA);
  const [status, setStatus] = useState<ZaloMessageTemplateStatus | "">("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<
    ZaloMessageTemplate | null | undefined
  >(undefined);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [historyTemplate, setHistoryTemplate] = useState<ZaloMessageTemplate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const [templateResult, quotaResult] = await Promise.allSettled([
      listZaloMessageTemplates({
        offset: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
        status,
        search,
      }),
      getZaloMessageQuota(),
    ]);
    if (templateResult.status === "fulfilled") {
      setTemplates(templateResult.value.data);
      setTotal(templateResult.value.metadata.total);
    } else
      setError(
        "Không tải được mẫu tin Zalo: " + errorMessage(templateResult.reason),
      );
    if (quotaResult.status === "fulfilled") setQuota(quotaResult.value);
    setLoading(false);
  }, [page, search, status]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (input: ZaloMessageTemplateInput) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (editing) await updateZaloMessageTemplate(editing.id, input);
      else await createZaloMessageTemplate(input);
      setMessage(editing ? "Đã cập nhật mẫu tin." : "Đã tạo mẫu tin mới.");
      setEditing(undefined);
      setPage(1);
      await load();
    } catch (saveError) {
      setError("Không thể lưu mẫu tin: " + errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (template: ZaloMessageTemplate) => {
    if (!window.confirm(`Xóa mẫu tin “${template.name}”?`)) return;
    try {
      await deleteZaloMessageTemplate(template.id);
      setMessage("Đã xóa mẫu tin.");
      await load();
    } catch (deleteError) {
      setError("Không thể xóa mẫu tin: " + errorMessage(deleteError));
    }
  };
  const clone = async (template: ZaloMessageTemplate) => {
    try {
      await cloneZaloMessageTemplate(template.id);
      setMessage("Đã nhân bản mẫu tin.");
      await load();
    } catch (cloneError) {
      setError("Không thể nhân bản mẫu tin: " + errorMessage(cloneError));
    }
  };
  const toggle = async (template: ZaloMessageTemplate) => {
    try {
      await toggleZaloMessageTemplate(
        template.id,
        template.status === "active" ? "archived" : "active",
      );
      setMessage("Đã cập nhật trạng thái mẫu tin.");
      await load();
    } catch (toggleError) {
      setError("Không thể cập nhật trạng thái: " + errorMessage(toggleError));
    }
  };
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const quotaPercent = quota.limit
    ? Math.min(100, Math.round((quota.used / quota.limit) * 100))
    : 0;

  return (
    <div>
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-accent">
            Zalo cá nhân
          </p>
          <h1 className="font-heading mt-1 text-2xl font-bold text-ink">
            Tin nhắn Zalo
          </h1>
          <p className="mt-1 text-sm text-muted">
            Tạo mẫu nhiều nội dung và gửi có kiểm soát đến khách tham dự.
          </p>
        </div>
        {(canManage || canSend) && (
          <div className="flex flex-wrap gap-2">
            {canSend && (
              <button
                type="button"
                onClick={() => setBulkOpen(true)}
                disabled={
                  !templates.some((template) => template.status === "active")
                }
                className="min-h-10 rounded-md border border-brand px-4 text-sm font-semibold text-brand disabled:opacity-40"
              >
                Gửi hàng loạt
              </button>
            )}
            {canManage && (
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="min-h-10 rounded-md bg-brand px-4 text-sm font-semibold text-brand-teal"
              >
                + Tạo mẫu tin
              </button>
            )}
          </div>
        )}
      </div>
      {message && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-success-border bg-success-soft px-4 py-3 text-sm text-success">
          <span>{message}</span>
          <button onClick={() => setMessage("")} aria-label="Đóng thông báo">
            ×
          </button>
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-error">
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="Đóng lỗi">
            ×
          </button>
        </div>
      )}

      <section className="mb-5 rounded-lg border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-muted">
              Quota gửi tin
            </div>
            <div className="mt-1 flex items-end gap-2">
              <strong className="font-heading text-3xl text-brand-teal">
                {quota.remaining.toLocaleString("vi-VN")}
              </strong>
              <span className="pb-1 text-sm text-muted">tin còn lại</span>
            </div>
          </div>
          <div className="w-full max-w-md">
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span>
                Đã dùng {quota.used.toLocaleString("vi-VN")}/
                {quota.limit.toLocaleString("vi-VN")}
              </span>
              <span>{quotaPercent}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-muted">
              <div
                className={`h-full rounded-full ${quotaPercent >= 90 ? "bg-red-500" : quotaPercent >= 70 ? "bg-amber-500" : "bg-brand"}`}
                style={{ width: `${quotaPercent}%` }}
              />
            </div>
            <div className="mt-1 text-right text-xs text-muted">
              Làm mới: {formatDateTime(quota.resets_at)}
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        <div className="border-b border-line px-4 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-heading font-bold text-ink">
                Danh sách mẫu tin
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                {total} mẫu tin trong hệ thống
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setPage(1);
                  setSearch(searchInput);
                }}
                className="flex"
              >
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Tìm theo tên mẫu tin"
                  className="min-h-10 min-w-0 rounded-l-md border border-line px-3 text-sm outline-none focus:border-brand sm:w-60"
                />
                <button
                  type="submit"
                  className="rounded-r-md border border-l-0 border-line px-3 text-sm font-semibold text-brand-teal"
                >
                  Tìm
                </button>
              </form>
              <select
                value={status}
                onChange={(event) => {
                  setPage(1);
                  setStatus(
                    event.target.value as ZaloMessageTemplateStatus | "",
                  );
                }}
                className="min-h-10 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-brand"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="admin-table-scroll">
          <table className="w-full min-w-[850px] text-sm">
            <thead className="bg-surface-muted text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-3">Tên mẫu tin</th>
                <th className="px-4 py-3">Nội dung</th>
                <th className="px-4 py-3">Trạng thái</th>
                <th className="px-4 py-3">Cập nhật</th>
                <th className="px-4 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading
                ? [1, 2, 3, 4].map((row) => (
                    <tr key={row}>
                      {[1, 2, 3, 4, 5].map((cell) => (
                        <td key={cell} className="px-4 py-4">
                          <div className="h-4 animate-pulse rounded bg-surface-muted" />
                        </td>
                      ))}
                    </tr>
                  ))
                : templates.map((template) => {
                    const statusMeta =
                      STATUS_META[template.status] || STATUS_META.draft;
                    const counts = template.blocks.reduce<
                      Record<string, number>
                    >(
                      (result, block) => ({
                        ...result,
                        [block.type]: (result[block.type] || 0) + 1,
                      }),
                      {},
                    );
                    return (
                      <tr key={template.id} className="hover:bg-brand/5">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-ink">
                            {template.name}
                          </div>
                          <div className="mt-0.5 max-w-xs truncate text-xs text-muted">
                            {template.description || template.id}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-text-secondary">
                          {template.blocks.length} block · {counts.text || 0}{" "}
                          text · {counts.image || 0} ảnh · {counts.video || 0}{" "}
                          video
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusMeta.className}`}
                          >
                            {statusMeta.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted">
                          {formatDateTime(template.updated_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-3">
                            {canReadDeliveries && <button type="button" onClick={() => setHistoryTemplate(template)} className="min-h-8 font-semibold text-brand-teal underline">Lịch sử</button>}
                            <button
                              type="button"
                              onClick={() => setEditing(template)}
                              className="min-h-8 font-semibold text-brand underline"
                            >
                              {canManage ? "Sửa" : "Xem"}
                            </button>
                            {canManage && (
                              <>
                                <button type="button" onClick={() => void clone(template)} className="min-h-8 font-semibold text-brand-teal underline">Nhân bản</button>
                                <button type="button" onClick={() => void toggle(template)} className="min-h-8 font-semibold text-amber-700 underline">{template.status === "active" ? "Tạm ngưng" : "Bật"}</button>
                                <button type="button" onClick={() => void remove(template)} className="min-h-8 font-semibold text-red-600 underline">Xóa</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              {!loading && !templates.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-14 text-center">
                    <div className="font-semibold text-ink">
                      Chưa có mẫu tin phù hợp
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      Hãy đổi bộ lọc hoặc tạo mẫu tin đầu tiên.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
          <span className="text-muted">Tổng cộng {total} mẫu tin</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((value) => value - 1)}
              className="min-h-9 rounded border border-line px-3 disabled:opacity-40"
            >
              Trang trước
            </button>
            <span className="text-muted">
              Trang {page}/{totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((value) => value + 1)}
              className="min-h-9 rounded border border-line px-3 disabled:opacity-40"
            >
              Trang sau
            </button>
          </div>
        </div>
      </section>
      {editing !== undefined && (
        <TemplateEditor
          template={editing}
          saving={saving}
          readOnly={!canManage}
          onClose={() => setEditing(undefined)}
          onSave={(input) => void save(input)}
        />
      )}
      {bulkOpen && (
        <BulkSendModal
          templates={templates}
          onClose={() => setBulkOpen(false)}
          onSent={() => void load()}
        />
      )}
      {historyTemplate && <TemplateDeliveryHistory template={historyTemplate} canSend={canSend} onClose={() => setHistoryTemplate(null)} />}
    </div>
  );
}
