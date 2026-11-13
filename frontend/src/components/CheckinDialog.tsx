"use client";

import { useEffect, useRef, useState } from "react";
import { useDialogFocus } from "@/hooks/useDialogFocus";

type CheckinGuest = { full_name: string; party_size?: number | null };

/**
 * Hộp thoại xác nhận check-in kèm số người thực tế (bottom sheet trên mobile, giữa màn hình trên desktop).
 * Thay cho window.prompt(): một số trình duyệt nhúng (pane trong app, trình duyệt trong Zalo…) chặn prompt.
 */
export default function CheckinDialog({ guest, onClose, onConfirm }: {
  guest: CheckinGuest;
  onClose: () => void;
  onConfirm: (actual: number) => void | Promise<void>;
}) {
  const registered = Math.max(1, guest.party_size || 1);
  const [actual, setActual] = useState(registered);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, dialogRef, "#checkin-actual");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try { await onConfirm(actual); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="checkin-dialog-title">
      <button type="button" className="absolute inset-0 bg-black/60" onClick={() => !busy && onClose()} aria-label="Đóng xác nhận check-in" />
      <div ref={dialogRef} tabIndex={-1} className="relative w-full max-w-md rounded-t-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl animate-sheet-up sm:rounded-2xl sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Xác nhận check-in</p>
            <h2 id="checkin-dialog-title" className="mt-1 font-heading text-xl font-bold text-brand-teal">{guest.full_name}</h2>
            <p className="mt-1 text-sm text-text-secondary">Đã đăng ký {registered} khách</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="grid h-11 w-11 place-items-center rounded-md border border-line text-brand-teal" aria-label="Đóng">
            <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <label htmlFor="checkin-actual" className="mt-5 block text-sm font-semibold text-brand-teal">Số người tham gia thực tế</label>
        <form onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
          <div className="mt-2 grid h-12 grid-cols-[48px_1fr_48px] overflow-hidden rounded-md border border-line">
            <button type="button" onClick={() => setActual((value) => Math.max(1, value - 1))} disabled={actual <= 1 || busy} className="grid place-items-center text-brand-teal disabled:opacity-40" aria-label="Giảm số khách">
              <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4"><path d="M5 12h14" /></svg>
            </button>
            <input id="checkin-actual" type="number" inputMode="numeric" min={1} value={actual}
              onChange={(event) => setActual(Math.max(1, parseInt(event.target.value, 10) || 1))}
              className="border-x border-line bg-white text-center font-mono text-lg text-brand-teal focus:outline-none" />
            <button type="button" onClick={() => setActual((value) => value + 1)} disabled={busy} className="grid place-items-center text-brand-teal disabled:opacity-40" aria-label="Tăng số khách">
              <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
          {actual !== registered && <p className="mt-2 text-xs font-semibold text-red-600">Khác số đăng ký ({registered} khách)</p>}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="h-12 rounded-md border border-line font-semibold text-brand-teal">Hủy</button>
            <button type="submit" disabled={busy} className="h-12 rounded-md bg-brand font-bold text-brand-teal disabled:opacity-50">{busy ? "Đang check-in..." : `Check-in · ${actual} khách`}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
