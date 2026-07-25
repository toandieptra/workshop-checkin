"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { ZaloMessageBlock } from "@/types/zalo-message";
import { albumImages } from "./utils";

export default function AlbumGrid({
  block,
  editable = false,
  onRemove,
  onMove,
}: {
  block: ZaloMessageBlock;
  editable?: boolean;
  onRemove?: (imageId: string) => void;
  onMove?: (imageIndex: number, offset: number) => void;
}) {
  const images = albumImages(block);
  if (!images.length) {
    return (
      <div className="grid h-32 place-items-center rounded-md bg-surface-muted text-xs text-muted">
        Ảnh sẽ hiển thị tại đây
      </div>
    );
  }
  return (
    <div
      className={`grid gap-1 overflow-hidden rounded-md ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
    >
      {images.map((image, index) => (
        <div
          key={image.id}
          className="group relative aspect-square overflow-hidden bg-surface-muted"
        >
          <img
            src={image.url}
            alt={`Ảnh ${index + 1} trong album`}
            className="h-full w-full object-cover"
          />
          {editable && (
            <div className="absolute inset-x-1 bottom-1 flex justify-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => onMove?.(index, -1)}
                className="grid h-8 w-8 place-items-center rounded bg-white/95 text-ink shadow disabled:opacity-40"
                aria-label="Đưa ảnh sang trái"
              >
                <ChevronLeftIcon className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => onRemove?.(image.id)}
                className="grid h-8 w-8 place-items-center rounded bg-white/95 text-red-600 shadow"
                aria-label="Xóa ảnh"
              >
                <XMarkIcon className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                disabled={index === images.length - 1}
                onClick={() => onMove?.(index, 1)}
                className="grid h-8 w-8 place-items-center rounded bg-white/95 text-ink shadow disabled:opacity-40"
                aria-label="Đưa ảnh sang phải"
              >
                <ChevronRightIcon className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
