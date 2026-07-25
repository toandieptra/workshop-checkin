"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bars3Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  DocumentTextIcon,
  PhotoIcon,
  TrashIcon,
  VideoCameraIcon,
} from "@heroicons/react/24/outline";
import { getZaloTemplateVariables, uploadZaloMessageMedia } from "@/lib/api";
import type {
  ZaloMessageBlock,
  ZaloMessageBlockType,
  ZaloTemplateVariable,
} from "@/types/zalo-message";
import AlbumGrid from "./AlbumGrid";
import { MAX_MEDIA_COUNT, MAX_MEDIA_FILE_SIZE } from "./constants";
import {
  albumImages,
  blockId,
  blockTypeLabel,
  emptyBlock,
  errorMessage,
  mediaCount,
} from "./utils";

export default function BlockEditor({
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
  const variablePopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getZaloTemplateVariables().then(setVariables);
  }, []);

  useEffect(() => {
    if (!variableBlockId) return;
    const onPointer = (event: MouseEvent) => {
      if (!variablePopoverRef.current?.contains(event.target as Node)) {
        setVariableBlockId("");
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVariableBlockId("");
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [variableBlockId]);

  const patch = (id: string, values: Partial<ZaloMessageBlock>) =>
    onChange(blocks.map((block) => (block.id === id ? { ...block, ...values } : block)));

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
      setMediaError((current) => ({
        ...current,
        [block.id]: `${file.name}: vượt giới hạn 50MB/file.`,
      }));
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
      setMediaError((current) => ({
        ...current,
        [block.id]: "Tải video thất bại: " + errorMessage(error),
      }));
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
      setMediaError((current) => ({
        ...current,
        [block.id]: `${oversized.name}: vượt giới hạn 50MB/file.`,
      }));
      return;
    }
    const remaining = MAX_MEDIA_COUNT - mediaCount(blocks);
    if (remaining <= 0 || selected.length > remaining) {
      setMediaError((current) => ({
        ...current,
        [block.id]: `Chỉ có thể thêm ${Math.max(remaining, 0)} ảnh; toàn template tối đa 10 media.`,
      }));
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
        onChange(
          blocks.map((item) =>
            item.id === block.id ? { ...item, images, url: undefined } : item,
          ),
        );
      } catch (error) {
        setMediaError((current) => ({
          ...current,
          [block.id]: `Ảnh ${index + 1}/${selected.length} (${file.name}) thất bại: ${errorMessage(error)}. ${images.length - albumImages(block).length} ảnh trước đó đã được thêm.`,
        }));
        break;
      }
    }
    setUploadingId("");
    setUploadProgress("");
  };

  const uploadThumbnail = async (block: ZaloMessageBlock, file?: File) => {
    if (!file || block.type !== "video") return;
    if (file.size > MAX_MEDIA_FILE_SIZE) {
      setMediaError((current) => ({
        ...current,
        [block.id]: `${file.name}: vượt giới hạn 50MB/file.`,
      }));
      return;
    }
    setUploadingId(`${block.id}-thumbnail`);
    try {
      const result = await uploadZaloMessageMedia(file, "thumbnail");
      patch(block.id, { thumbnail_url: result.url });
    } catch (error) {
      setMediaError((current) => ({
        ...current,
        [block.id]: "Tải thumbnail thất bại: " + errorMessage(error),
      }));
    } finally {
      setUploadingId("");
    }
  };

  const addImageUrl = (block: ZaloMessageBlock) => {
    const url = (imageUrls[block.id] || "").trim();
    if (!url) return;
    if (mediaCount(blocks) >= MAX_MEDIA_COUNT) {
      setMediaError((current) => ({
        ...current,
        [block.id]: "Template đã đạt giới hạn 10 media.",
      }));
      return;
    }
    patch(block.id, {
      images: [...albumImages(block), { id: blockId(), url }],
      url: undefined,
    });
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

  const addBlockIcons: Record<
    ZaloMessageBlockType,
    typeof DocumentTextIcon
  > = {
    text: DocumentTextIcon,
    image: PhotoIcon,
    video: VideoCameraIcon,
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
                  className="cursor-grab text-muted"
                  title="Kéo để sắp xếp"
                  aria-hidden
                >
                  <Bars3Icon className="h-5 w-5" />
                </span>
                <span className="truncate text-sm font-bold text-ink">
                  {index + 1}. {blockTypeLabel(block.type)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="grid h-8 w-8 place-items-center rounded border border-line text-ink transition hover:bg-surface-muted disabled:opacity-30"
                  aria-label="Đưa block lên"
                >
                  <ChevronUpIcon className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  disabled={index === blocks.length - 1}
                  onClick={() => move(index, 1)}
                  className="grid h-8 w-8 place-items-center rounded border border-line text-ink transition hover:bg-surface-muted disabled:opacity-30"
                  aria-label="Đưa block xuống"
                >
                  <ChevronDownIcon className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChange(blocks.filter((item) => item.id !== block.id))
                  }
                  className="grid h-8 w-8 place-items-center rounded border border-red-200 text-red-600 transition hover:bg-red-50"
                  aria-label="Xóa block"
                >
                  <TrashIcon className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
            {block.type === "text" ? (
              <div className="relative space-y-1.5">
                <textarea
                  ref={(element) => {
                    textareas.current[block.id] = element;
                  }}
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
                  <button
                    type="button"
                    onClick={() => {
                      setVariableBlockId(
                        variableBlockId === block.id ? "" : block.id,
                      );
                      setVariableSearch("");
                    }}
                    className="rounded-full border border-brand px-3 py-1.5 font-semibold text-brand transition hover:bg-brand/5"
                  >
                    Chèn biến{" "}
                    <span className="ml-1 rounded-full bg-brand/10 px-1.5">
                      {variables.length}
                    </span>
                  </button>
                </div>
                {variableBlockId === block.id && (
                  <div
                    ref={variablePopoverRef}
                    className="absolute right-0 z-20 mt-1 w-full max-w-sm rounded-lg border border-line bg-white p-3 shadow-xl"
                  >
                    <input
                      autoFocus
                      value={variableSearch}
                      onChange={(event) => setVariableSearch(event.target.value)}
                      placeholder="Tìm biến..."
                      className="min-h-9 w-full rounded border border-line px-3 text-sm outline-none focus:border-brand"
                    />
                    <div className="mt-2 max-h-64 overflow-y-auto">
                      {(["Guest", "Workshop"] as const).map((group) => {
                        const term = variableSearch.trim().toLocaleLowerCase("vi");
                        const items = variables.filter(
                          (variable) =>
                            variable.group === group &&
                            `${variable.label} ${variable.key} ${variable.description || ""}`
                              .toLocaleLowerCase("vi")
                              .includes(term),
                        );
                        return items.length ? (
                          <div key={group} className="mb-2">
                            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                              {group}
                            </div>
                            {items.map((variable) => (
                              <div
                                key={variable.key}
                                className="flex items-center gap-1 rounded hover:bg-brand/5"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    insertVariable(block, variable.key)
                                  }
                                  className="min-w-0 flex-1 px-2 py-2 text-left"
                                >
                                  <span className="block truncate text-xs font-semibold text-ink">
                                    {variable.label}
                                  </span>
                                  <code className="text-[11px] text-brand">
                                    {variable.key}
                                  </code>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void navigator.clipboard?.writeText(
                                      variable.key,
                                    )
                                  }
                                  className="mr-1 rounded border border-line px-2 py-1 text-[10px] transition hover:bg-surface-muted"
                                  aria-label={`Sao chép ${variable.key}`}
                                >
                                  Copy
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null;
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {block.type === "image" ? (
                  <>
                    <AlbumGrid
                      block={block}
                      editable
                      onRemove={(imageId) =>
                        patch(block.id, {
                          images: albumImages(block).filter(
                            (image) => image.id !== imageId,
                          ),
                          url: undefined,
                        })
                      }
                      onMove={(imageIndex, offset) => {
                        const images = [...albumImages(block)];
                        const target = imageIndex + offset;
                        if (target < 0 || target >= images.length) return;
                        [images[imageIndex], images[target]] = [
                          images[target],
                          images[imageIndex],
                        ];
                        patch(block.id, { images, url: undefined });
                      }}
                    />
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={imageUrls[block.id] || ""}
                        onChange={(event) =>
                          setImageUrls((current) => ({
                            ...current,
                            [block.id]: event.target.value,
                          }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            addImageUrl(block);
                          }
                        }}
                        placeholder="https://... thêm ảnh vào album"
                        className="min-h-10 min-w-0 flex-1 rounded-md border border-line px-3 text-sm outline-none focus:border-brand"
                      />
                      <button
                        type="button"
                        onClick={() => addImageUrl(block)}
                        className="rounded-md border border-brand px-3 text-xs font-semibold text-brand transition hover:bg-brand/5"
                      >
                        Thêm URL
                      </button>
                    </div>
                    <label className="inline-flex cursor-pointer rounded-md border border-brand px-3 py-2 text-xs font-semibold text-brand transition hover:bg-brand/5">
                      {uploadingId === block.id
                        ? uploadProgress || "Đang tải..."
                        : "Tải nhiều ảnh lên"}
                      <input
                        type="file"
                        multiple
                        disabled={!!uploadingId}
                        accept="image/*"
                        onChange={(event) => {
                          void uploadImages(block, event.target.files);
                          event.target.value = "";
                        }}
                        className="sr-only"
                      />
                    </label>
                    <div className="text-xs text-muted">
                      {albumImages(block).length} ảnh trong album · 50MB/file ·{" "}
                      {mediaCount(blocks)}/{MAX_MEDIA_COUNT} media/template
                    </div>
                  </>
                ) : (
                  <label className="block text-xs font-semibold text-text-secondary">
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
                  </label>
                )}
                {block.type === "video" && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted">hoặc</span>
                    <label className="cursor-pointer rounded-md border border-brand px-3 py-2 text-xs font-semibold text-brand transition hover:bg-brand/5">
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
                  </div>
                )}
                {block.type === "video" && (
                  <div className="text-xs text-muted">
                    50MB/file · {mediaCount(blocks)}/{MAX_MEDIA_COUNT}{" "}
                    media/template
                  </div>
                )}
                {block.type === "video" && (
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-text-secondary">
                      URL thumbnail
                      <input
                        type="url"
                        value={block.thumbnail_url || ""}
                        onChange={(event) =>
                          patch(block.id, {
                            thumbnail_url: event.target.value,
                          })
                        }
                        placeholder="https://... hoặc tải thumbnail lên"
                        className="mt-1 min-h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-brand"
                      />
                    </label>
                    <label className="inline-flex cursor-pointer rounded-md border border-brand px-3 py-2 text-xs font-semibold text-brand transition hover:bg-brand/5">
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
                {mediaError[block.id] && (
                  <div
                    role="alert"
                    className="rounded bg-red-50 px-3 py-2 text-xs text-red-700"
                  >
                    {mediaError[block.id]}
                  </div>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {(["text", "image", "video"] as ZaloMessageBlockType[]).map((type) => {
          const Icon = addBlockIcons[type];
          return (
            <button
              key={type}
              type="button"
              disabled={type !== "text" && mediaCount(blocks) >= MAX_MEDIA_COUNT}
              onClick={() => onChange([...blocks, emptyBlock(type)])}
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border border-dashed border-brand px-2 text-xs font-semibold text-brand transition hover:bg-brand/5 disabled:opacity-40"
            >
              <Icon className="h-4 w-4" aria-hidden />
              {blockTypeLabel(type)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
