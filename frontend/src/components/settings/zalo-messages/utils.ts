import type { ZaloMessageBlock, ZaloMessageBlockType } from "@/types/zalo-message";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Không rõ lỗi";
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}

export function blockId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `block-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function emptyBlock(type: ZaloMessageBlockType): ZaloMessageBlock {
  return {
    id: blockId(),
    type,
    ...(type === "text" ? { text: "" } : type === "image" ? { images: [] } : { url: "" }),
  };
}

export function albumImages(block: ZaloMessageBlock) {
  return block.images?.length
    ? block.images
    : block.url
      ? [{ id: `${block.id}-legacy`, url: block.url }]
      : [];
}

export function mediaCount(blocks: ZaloMessageBlock[]) {
  return blocks.reduce(
    (count, block) =>
      count +
      (block.type === "image" ? albumImages(block).length : block.type === "video" ? 1 : 0),
    0,
  );
}

export function blockTypeLabel(type: ZaloMessageBlockType): string {
  if (type === "text") return "Văn bản";
  if (type === "image") return "Hình ảnh";
  return "Video";
}
