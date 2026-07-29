"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArchiveBoxIcon,
  ClipboardDocumentIcon,
  ClockIcon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
  PlayIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import type { ZaloMessageTemplate } from "@/types/zalo-message";

export default function TemplateRowActions({
  template,
  canEdit,
  canCreate,
  canDelete,
  canReadDeliveries,
  busy,
  onEdit,
  onHistory,
  onClone,
  onToggle,
  onRemove,
}: {
  template: ZaloMessageTemplate;
  canEdit: boolean;
  canCreate: boolean;
  canDelete: boolean;
  canReadDeliveries: boolean;
  busy: boolean;
  onEdit: () => void;
  onHistory: () => void;
  onClone: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const menuItems = [
    canReadDeliveries && {
      key: "history",
      label: "Lịch sử gửi",
      icon: ClockIcon,
      onClick: onHistory,
      className: "text-ink",
    },
    canCreate && {
      key: "clone",
      label: "Nhân bản",
      icon: ClipboardDocumentIcon,
      onClick: onClone,
      className: "text-ink",
    },
    canEdit && {
      key: "toggle",
      label: template.status === "active" ? "Tạm ngưng" : "Bật sử dụng",
      icon: template.status === "active" ? ArchiveBoxIcon : PlayIcon,
      onClick: onToggle,
      className: "text-amber-800",
    },
    canDelete && {
      key: "delete",
      label: "Xóa mẫu tin",
      icon: TrashIcon,
      onClick: onRemove,
      className: "text-red-600",
    },
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    icon: typeof ClockIcon;
    onClick: () => void;
    className: string;
  }>;

  return (
    <div ref={rootRef} className="relative flex justify-end gap-2">
      <button
        type="button"
        onClick={onEdit}
        disabled={busy}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-brand px-3 text-xs font-semibold text-brand transition hover:bg-brand/5 disabled:opacity-40"
      >
        <PencilSquareIcon className="h-4 w-4" aria-hidden />
        {canEdit ? "Sửa" : "Xem"}
      </button>
      {!!menuItems.length && (
        <>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            disabled={busy}
            className="grid h-9 w-9 place-items-center rounded-md border border-line text-ink transition hover:bg-surface-muted disabled:opacity-40"
            aria-label="Thêm thao tác"
            aria-expanded={open}
            aria-haspopup="menu"
          >
            <EllipsisVerticalIcon className="h-5 w-5" aria-hidden />
          </button>
          {open && (
            <div
              role="menu"
              className="absolute right-0 top-full z-20 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lg"
            >
              {menuItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      item.onClick();
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium transition hover:bg-brand/5 ${item.className}`}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
