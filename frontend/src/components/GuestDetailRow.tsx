"use client";

import { useEffect, useRef, useState } from "react";
import GuestDetailContent from "@/components/GuestDetailContent";
import type { Guest, GuestDetailState } from "@/hooks/useAdminGuests";

export default function GuestDetailRow({
  detail,
  colSpan,
  workshopName,
  workshopId,
  onRetryLoad,
  onEdit,
  onCheckin,
  onConfirmRegistration,
  onUncheckin,
  onToggleVip,
  onDelete,
  onResolveConflict,
  onSendManualZbs,
  canSendManualZbs,
}: {
  detail?: GuestDetailState;
  colSpan: number;
  workshopName: string;
  workshopId: string;
  onRetryLoad: () => void;
  onEdit: (guest: Guest) => void;
  onCheckin: (guest: Guest) => void;
  onConfirmRegistration: (guest: Guest) => void;
  onUncheckin: (guest: Guest) => void;
  onToggleVip: (guest: Guest) => void;
  onDelete: (guest: Guest) => void;
  onResolveConflict: (guest: Guest, direction: "local" | "lark") => void;
  onSendManualZbs: (guest: Guest, taskKey: "registration_confirmation" | "checkin_confirmation") => void;
  canSendManualZbs: boolean;
}) {
  const cellRef = useRef<HTMLTableCellElement>(null);
  const [viewport, setViewport] = useState({ width: 0, offset: 0 });

  useEffect(() => {
    const container = cellRef.current?.closest(".admin-table-scroll") as HTMLElement | null;
    if (!container) return;
    const update = () => setViewport({ width: container.clientWidth, offset: container.scrollLeft });
    update();
    container.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => {
      container.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  return <tr className="border-x-2 border-b-2 border-brand bg-[#f4fbfc]">
    <td ref={cellRef} colSpan={colSpan} className="overflow-hidden p-0 align-top">
      <div style={viewport.width ? { width: viewport.width, transform: `translateX(${viewport.offset}px)` } : undefined}>
        {detail?.loading && !detail.data ? <div className="space-y-3 p-5" aria-label="Đang tải chi tiết khách">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-12 animate-pulse rounded bg-white" />)}
        </div> : detail?.error && !detail.data ? <div className="p-8 text-center">
          <div className="font-semibold text-error">Không tải được thông tin khách</div>
          <div className="mt-1 text-sm text-muted">{detail.error}</div>
          <button type="button" onClick={onRetryLoad} className="mt-4 min-h-9 rounded-md border border-brand px-4 text-sm font-semibold text-brand">Thử lại</button>
        </div> : detail?.data ? <GuestDetailContent
          guest={detail.data}
          workshopName={workshopName}
          workshopId={workshopId}
          onEdit={onEdit}
          onCheckin={onCheckin}
          onConfirmRegistration={onConfirmRegistration}
          onUncheckin={onUncheckin}
          onToggleVip={onToggleVip}
          onDelete={onDelete}
          onResolveConflict={onResolveConflict}
          onSendManualZbs={onSendManualZbs}
          canSendManualZbs={canSendManualZbs}
        /> : <div className="p-8 text-center text-muted">Không tìm thấy thông tin khách.</div>}
      </div>
    </td>
  </tr>;
}
