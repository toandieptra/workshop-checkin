"use client";

import GuestQr from "@/components/GuestQr";
import type { Guest, ZbsDelivery } from "@/hooks/useAdminGuests";

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}

function isVip(guest: Guest): boolean {
  return (guest.guest_type || "").trim().toLowerCase() === "vip";
}

function zbsStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "Chờ gửi",
    sending: "Đang gửi",
    sent: "Đã gửi",
    delivered: "Đã nhận",
    failed: "Gửi lỗi",
    expired: "Quá hạn",
    cancelled: "Đã hủy",
  };
  return labels[status] || status;
}

function DetailField({ label, value, mono = false }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  return <div className="min-w-0">
    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
    <div className={`mt-1 break-words text-sm text-ink ${mono ? "font-mono text-xs" : "font-medium"}`}>{value || "—"}</div>
  </div>;
}

function ZbsDeliveryCard({ label, delivery, onSendManual }: {
  label: string;
  delivery?: ZbsDelivery;
  onSendManual?: () => void;
}) {
  if (!delivery) return <div className="rounded-md border border-line bg-white p-3">
    <div className="font-semibold text-ink">{label}</div>
    <div className="mt-1 text-xs text-muted">Chưa tạo tin gửi.</div>
    {onSendManual && <button type="button" onClick={onSendManual} className="mt-3 min-h-9 rounded-md border border-brand px-3 text-xs font-semibold text-brand hover:bg-brand/5">Gửi ZBS thủ công</button>}
  </div>;
  const failed = delivery.status === "failed";
  return <div className={`rounded-md border p-3 ${failed ? "border-red-200 bg-red-50" : "border-line bg-white"}`}>
    <div className="flex items-center justify-between gap-3">
      <div className="font-semibold text-ink">{label}</div>
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${delivery.status === "delivered" ? "bg-green-50 text-green-700" : failed ? "bg-red-100 text-red-700" : "bg-surface-muted text-muted"}`}>{zbsStatusLabel(delivery.status)}</span>
    </div>
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      <DetailField label="Số điện thoại" value={delivery.phone} mono />
      <DetailField label="Số lần thử" value={delivery.attempt_count} />
      <DetailField label="Mã tin Zalo" value={delivery.msg_id} mono />
      <DetailField label="Thời điểm gửi" value={formatDateTime(delivery.sent_time)} />
      <DetailField label="Thời điểm nhận" value={formatDateTime(delivery.delivery_time)} />
      <DetailField label="Cập nhật gần nhất" value={formatDateTime(delivery.updated_at)} />
    </div>
    {delivery.last_error && <div className="mt-3 whitespace-pre-wrap rounded bg-red-100/70 px-3 py-2 text-xs text-red-700">{delivery.last_error}</div>}
    {failed && onSendManual && <button type="button" onClick={onSendManual} className="mt-3 min-h-9 rounded-md border border-brand px-3 text-xs font-semibold text-brand hover:bg-brand/5">Gửi ZBS thủ công</button>}
  </div>;
}

export default function GuestDetailContent({
  guest,
  workshopName,
  workshopId,
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
  guest: Guest;
  workshopName: string;
  workshopId: string;
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
  const registered = guest.party_size || 1;
  const actual = guest.checkin_status === "checked_in" ? guest.actual_party_size ?? registered : null;
  const difference = actual === null ? null : actual - registered;
  const vip = isVip(guest);
  const source = guest.source === "Khác" && guest.source_detail ? `Khác: ${guest.source_detail}` : guest.source;

  return <div className="space-y-5 p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-heading text-xl font-bold text-brand-teal">{guest.full_name}</h3>
          {vip && <span className="rounded-full bg-cyan-200 px-2.5 py-1 text-xs font-bold text-cyan-900">VIP</span>}
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${guest.registration_status === "confirmed" ? "bg-green-50 text-green-700" : "bg-amber-100 text-amber-800"}`}>{guest.registration_status === "confirmed" ? "Đã xác nhận" : "Chờ xác nhận"}</span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${guest.checkin_status === "checked_in" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"}`}>{guest.checkin_status === "checked_in" ? "Đã Check-in" : "Chưa Check-in"}</span>
        </div>
        <p className="mt-1 text-sm text-muted">{workshopName}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2" data-row-action>
        {guest.registration_status !== "confirmed" && <button type="button" onClick={() => onConfirmRegistration(guest)} className="min-h-9 rounded-md bg-brand px-3 text-xs font-semibold text-brand-teal">Xác nhận đăng ký</button>}
        <button type="button" onClick={() => onEdit(guest)} className="min-h-9 rounded-md border border-brand px-3 text-xs font-semibold text-brand">Sửa</button>
        {guest.registration_status === "confirmed" && <button type="button" onClick={() => guest.checkin_status === "checked_in" ? onUncheckin(guest) : onCheckin(guest)} className={`min-h-9 rounded-md px-3 text-xs font-semibold ${guest.checkin_status === "checked_in" ? "bg-green-50 text-green-700" : "bg-green-700 text-white"}`}>{guest.checkin_status === "checked_in" ? "Hoàn tác Check-in" : "Check-in"}</button>}
        <button type="button" onClick={() => onToggleVip(guest)} className="min-h-9 rounded-md border border-line px-3 text-xs font-semibold text-text-secondary">{vip ? "Bỏ VIP" : "Đặt VIP"}</button>
        <div onClick={(event) => event.stopPropagation()}><GuestQr guestId={guest.id} guestName={guest.full_name} workshopId={workshopId} workshopName={workshopName} /></div>
        <button type="button" onClick={() => onDelete(guest)} className="min-h-9 rounded-md border border-red-200 px-3 text-xs font-semibold text-red-600">Xóa</button>
      </div>
    </div>

    <div className="grid gap-4 rounded-md border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
      <DetailField label="Số điện thoại" value={guest.phone} mono />
      <DetailField label="Mô hình kinh doanh" value={guest.business_model} />
      <DetailField label="Nguồn" value={source} />
      <DetailField label="Người tạo" value={guest.creator_name} />
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-md border border-line bg-white p-4">
        <h4 className="font-semibold text-ink">Đăng ký và Check-in</h4>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <DetailField label="Số khách đăng ký" value={`${registered} khách`} />
          <DetailField label="Trạng thái xác nhận" value={guest.registration_status === "confirmed" ? "Đã xác nhận" : "Chờ xác nhận"} />
          <DetailField label="Thời điểm xác nhận" value={formatDateTime(guest.confirmed_at)} />
          <DetailField label="Số khách thực tế" value={actual === null ? "—" : `${actual} khách`} />
          <DetailField label="Chênh lệch" value={difference === null ? "—" : difference === 0 ? "Khớp đăng ký" : `${difference > 0 ? "+" : ""}${difference} khách`} />
          <DetailField label="Thời điểm Check-in" value={formatDateTime(guest.checked_in_at)} />
          <DetailField label="Ngày đăng ký" value={formatDateTime(guest.registered_at)} />
          <DetailField label="Ngày tạo dữ liệu" value={formatDateTime(guest.created_at)} />
        </div>
      </section>
      <section className="rounded-md border border-line bg-white p-4">
        <h4 className="font-semibold text-ink">Đồng bộ Lark</h4>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <DetailField label="Trạng thái" value={guest.sync_status} />
          <DetailField label="Lark record ID" value={guest.lark_record_id} mono />
          <DetailField label="Cập nhật local" value={formatDateTime(guest.local_updated_at)} />
          <DetailField label="Cập nhật Lark" value={formatDateTime(guest.lark_updated_at)} />
          <DetailField label="Đồng bộ gần nhất" value={formatDateTime(guest.last_synced_at)} />
          <DetailField label="Mã Workshop" value={guest.workshop_id || workshopId} mono />
        </div>
        {guest.sync_error && <div className="mt-4 whitespace-pre-wrap rounded bg-red-50 px-3 py-2 text-xs text-red-700">{guest.sync_error}</div>}
        {guest.sync_status === "conflict" && <div className="mt-4 flex gap-2" data-row-action>
          <button type="button" onClick={() => onResolveConflict(guest, "local")} className="min-h-9 rounded border border-blue-200 px-3 text-xs font-semibold text-blue-700">Ưu tiên Local</button>
          <button type="button" onClick={() => onResolveConflict(guest, "lark")} className="min-h-9 rounded border border-purple-200 px-3 text-xs font-semibold text-purple-700">Ưu tiên Lark</button>
        </div>}
      </section>
    </div>

    <section>
      <h4 className="mb-3 font-semibold text-ink">Trạng thái gửi ZBS</h4>
      <div className="grid gap-3 lg:grid-cols-2">
        <ZbsDeliveryCard label="Xác nhận đăng ký Workshop" delivery={guest.zbs?.registration_confirmation} onSendManual={canSendManualZbs ? () => onSendManualZbs(guest, "registration_confirmation") : undefined} />
        <ZbsDeliveryCard label="Xác nhận Check-in Workshop" delivery={guest.zbs?.checkin_confirmation} onSendManual={canSendManualZbs && guest.checkin_status === "checked_in" ? () => onSendManualZbs(guest, "checkin_confirmation") : undefined} />
      </div>
    </section>

    <section className="rounded-md border border-line bg-white p-4">
      <h4 className="font-semibold text-ink">Ghi chú</h4>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{guest.note || "Không có ghi chú."}</div>
    </section>
  </div>;
}
