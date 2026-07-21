"use client";

import { useRef, useState } from "react";
import { useOutsidePointerDown } from "@/hooks/useOutsidePointerDown";

export interface TableColumn<Key extends string> { key: Key; label: string }

export default function ColumnVisibilityMenu<Key extends string>({
  columns,
  visible,
  onChange,
  className = "",
}: {
  columns: readonly TableColumn<Key>[];
  visible: Record<Key, boolean>;
  onChange: (next: Record<Key, boolean>) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsidePointerDown(ref, () => setOpen(false), open);
  const count = columns.filter(({ key }) => visible[key]).length;
  const menuId = `column-menu-${columns.map(({ key }) => key).join("-")}`;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
        aria-controls={menuId}
        className="w-full sm:w-auto border border-line bg-surface px-3 py-2 rounded-sm text-sm inline-flex items-center justify-center gap-2 hover:bg-surface-muted">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
          <rect x="3" y="5" width="18" height="14" rx="1" /><path d="M9 5v14M15 5v14" />
        </svg>
        Cột hiển thị <span className="text-xs text-muted">{count}/{columns.length}</span>
      </button>
      {open && <div id={menuId} aria-label="Chọn cột trong bảng"
        className="absolute right-0 z-40 mt-1 w-56 rounded-md border border-line bg-surface p-2 shadow-lg">
        <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">Chọn cột trong bảng</div>
        {columns.map((column) => <label key={column.key}
          className="flex items-center gap-2 px-2 py-2 rounded-sm text-sm cursor-pointer hover:bg-surface-muted">
          <input type="checkbox" checked={visible[column.key]} disabled={visible[column.key] && count === 1}
            onChange={() => onChange({ ...visible, [column.key]: !visible[column.key] })} className="accent-brand" />
          {column.label}
        </label>)}
        <button type="button" onClick={() => onChange(Object.fromEntries(columns.map(({ key }) => [key, true])) as Record<Key, boolean>)}
          className="mt-1 w-full border-t border-line px-2 pt-2 text-left text-xs font-medium text-brand hover:underline">Hiển thị tất cả</button>
      </div>}
    </div>
  );
}
