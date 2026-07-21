"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Workshop } from "@/hooks/useAdminGuests";
import { formatEventDateTime, shortLocation } from "@/lib/date-format";
import { useOutsidePointerDown } from "@/hooks/useOutsidePointerDown";

function groupOf(workshop: Workshop): "Sắp diễn ra" | "Đã qua" | "Không có ngày" {
  if (!workshop.event_date) return "Không có ngày";
  const date = new Date(`${workshop.event_date.slice(0, 10)}T23:59:59`);
  return date.getTime() >= Date.now() ? "Sắp diễn ra" : "Đã qua";
}

export default function WorkshopPicker({
  workshops,
  value,
  onChange,
  compact = false,
}: {
  workshops: Workshop[];
  value: string;
  onChange: (id: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useOutsidePointerDown(rootRef, () => setOpen(false), open);
  const current = workshops.find((workshop) => workshop.id === value);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("vi");
    return [...workshops]
      .filter((workshop) => !normalized || `${workshop.name} ${workshop.location || ""} ${workshop.event_date || ""}`.toLocaleLowerCase("vi").includes(normalized))
      .sort((a, b) => (b.event_date || "").localeCompare(a.event_date || ""));
  }, [query, workshops]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((value) => !value)}
        className={`flex w-full items-center justify-between gap-3 rounded-md border border-line bg-surface text-left text-brand-teal ${compact ? "min-h-11 px-3 py-2" : "min-h-12 px-4 py-2.5"}`}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{current?.name || "Chọn workshop"}</span>
          {!compact && current && <span className="mt-0.5 block truncate text-xs text-text-secondary">{formatEventDateTime(current.event_date, current.event_time)}{current.location ? ` · ${shortLocation(current.location)}` : ""}</span>}
        </span>
        <svg className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-2 w-full min-w-[min(32rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-surface shadow-xl sm:min-w-[30rem]">
          <div className="border-b border-line p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActive(0); }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(filtered.length - 1, index + 1)); }
                if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
                if (event.key === "Enter" && filtered[active]) { event.preventDefault(); choose(filtered[active].id); }
                if (event.key === "Escape") setOpen(false);
              }}
              placeholder="Tìm tên, ngày hoặc địa điểm..."
              aria-label="Tìm workshop"
              className="h-11 w-full rounded-md border border-line px-3 text-sm text-brand-teal placeholder:text-text-secondary"
            />
          </div>
          <div role="listbox" aria-label="Danh sách workshop" className="max-h-80 overflow-y-auto p-2">
            {(["Sắp diễn ra", "Đã qua", "Không có ngày"] as const).map((group) => {
              const items = filtered.filter((workshop) => groupOf(workshop) === group);
              if (!items.length) return null;
              return <div key={group} className="mb-2 last:mb-0">
                <div className="px-2 py-1 text-xs font-bold uppercase tracking-wide text-text-secondary">{group}</div>
                {items.map((workshop) => {
                  const index = filtered.indexOf(workshop);
                  return <button
                    key={workshop.id}
                    type="button"
                    role="option"
                    aria-selected={workshop.id === value}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(workshop.id)}
                    className={`w-full rounded-md px-3 py-2.5 text-left ${index === active ? "bg-surface-muted" : ""} ${workshop.id === value ? "font-semibold text-brand-teal" : "text-text-secondary"}`}
                  >
                    <span className="block text-sm">{workshop.name}</span>
                    <span className="mt-0.5 block text-xs">{formatEventDateTime(workshop.event_date, workshop.event_time)}{workshop.location ? ` · ${shortLocation(workshop.location)}` : ""}</span>
                  </button>;
                })}
              </div>;
            })}
            {!filtered.length && <div className="px-3 py-8 text-center text-sm text-text-secondary">Không tìm thấy workshop</div>}
          </div>
        </div>
      )}
    </div>
  );
}
