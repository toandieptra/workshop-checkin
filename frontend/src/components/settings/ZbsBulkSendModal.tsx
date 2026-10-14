"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import {
  api,
  getZbsBulkBatch,
  getZbsBulkOptions,
  getZbsTemplate,
  listZbsGuestBulkStatuses,
  preflightZbsBulk,
  sendZbsBulk,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";
import type { Guest, Workshop } from "@/hooks/useAdminGuests";
import type {
  ZbsBulkBatch,
  ZbsBulkOptions,
  ZbsBulkPreflight,
  ZbsDeliveryStatus,
  ZbsGuestBulkStatus,
  ZbsParamMapping,
  ZbsTemplateDetail,
  ZbsTemplateListItem,
} from "@/types/zbs-template";
import { useModalDismiss } from "./zalo-messages/useModalDismiss";

const FIXED_SOURCE = "fixed";

export const DELIVERY_STATUS_META: Record<ZbsDeliveryStatus, { label: string; className: string }> = {
  pending: { label: "Chờ gửi", className: "bg-amber-50 text-amber-700" },
  sending: { label: "Đang gửi", className: "bg-sky-50 text-sky-700" },
  sent: { label: "Đã gửi", className: "bg-green-50 text-green-700" },
  delivered: { label: "Đã nhận", className: "bg-green-100 text-green-800" },
  failed: { label: "Lỗi", className: "bg-red-50 text-red-700" },
  expired: { label: "Hết hạn", className: "bg-gray-100 text-gray-600" },
  cancelled: { label: "Đã hủy", className: "bg-gray-100 text-gray-500" },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "không rõ";
}

function formatMoney(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString("vi-VN")} đ`;
}

function newBulkId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

export function StatusBadge({ status }: { status: ZbsDeliveryStatus }) {
  const meta = DELIVERY_STATUS_META[status] || { label: status, className: "bg-gray-100 text-gray-600" };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${meta.className}`}>{meta.label}</span>;
}

export default function ZbsBulkSendModal({
  templates,
  onClose,
  onSent,
}: {
  templates: ZbsTemplateListItem[];
  onClose: () => void;
  onSent: () => void;
}) {
  const { user, canForWorkshop } = useAuth();
  const accessKey = JSON.stringify([user?.role, user?.permissions, user?.workshop_access]);
  const canSendFor = useCallback(
    (id: string) => canForWorkshop(PERMISSIONS.guestsView, id) && canForWorkshop(PERMISSIONS.zbsManage, id),
    [canForWorkshop],
  );
  const [options, setOptions] = useState<ZbsBulkOptions | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [template, setTemplate] = useState<ZbsTemplateDetail | null>(null);
  const [mapping, setMapping] = useState<Record<string, ZbsParamMapping>>({});
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [workshopId, setWorkshopId] = useState("");
  const [guests, setGuests] = useState<Guest[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ZbsGuestBulkStatus>>({});
  const [search, setSearch] = useState("");
  const [registrationFilter, setRegistrationFilter] = useState("");
  const [checkinFilter, setCheckinFilter] = useState("");
  const [sendFilter, setSendFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [allowResend, setAllowResend] = useState(false);
  const [preflight, setPreflight] = useState<ZbsBulkPreflight | null>(null);
  const [result, setResult] = useState<ZbsBulkBatch | null>(null);
  const [loadingGuests, setLoadingGuests] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const bulkIdRef = useRef(newBulkId());

  const handleClose = useCallback(() => {
    if (submitting) return;
    if (!result && selected.length > 0 && !window.confirm("Đang chọn khách — đóng cửa sổ gửi hàng loạt?")) return;
    onClose();
  }, [onClose, result, selected.length, submitting]);
  useModalDismiss(handleClose);

  // Mọi thay đổi đầu vào làm kết quả kiểm tra cũ hết hiệu lực.
  const resetPreflight = () => setPreflight(null);

  useEffect(() => {
    let active = true;
    void getZbsBulkOptions()
      .then((data) => { if (active) setOptions(data); })
      .catch((loadError) => { if (active) setError("Không tải được cấu hình gửi: " + errorMessage(loadError)); });
    void api<Workshop[]>("/workshops?permission=guests.read")
      .then((data) => {
        if (!active) return;
        const allowed = data.filter((workshop) => canSendFor(workshop.id));
        setWorkshops(allowed);
        setWorkshopId((id) => allowed.some((workshop) => workshop.id === id) ? id : allowed[0]?.id || "");
      })
      .catch((loadError) => { if (active) setError("Không tải được workshop: " + errorMessage(loadError)); });
    return () => { active = false; };
  }, [accessKey, canSendFor]);

  useEffect(() => {
    let active = true;
    setTemplate(null);
    setMapping({});
    resetPreflight();
    if (!templateId || !options) return;
    void getZbsTemplate(templateId)
      .then((detail) => {
        if (!active) return;
        setTemplate(detail);
        setMapping(Object.fromEntries((detail.detail.listParams || []).map((param) => [param.name, {
          source: options.default_sources[param.name] || FIXED_SOURCE,
          value: "",
        }])));
      })
      .catch((loadError) => { if (active) setError("Không tải được chi tiết mẫu tin: " + errorMessage(loadError)); });
    return () => { active = false; };
  }, [templateId, options]);

  useEffect(() => {
    let active = true;
    setGuests([]);
    setSelected([]);
    resetPreflight();
    if (!workshopId) return;
    setLoadingGuests(true);
    void api<Guest[]>(`/workshops/${encodeURIComponent(workshopId)}/guests?sort_registered_at=desc`)
      .then((data) => { if (active) setGuests(data); })
      .catch((loadError) => { if (active) setError("Không tải được khách: " + errorMessage(loadError)); })
      .finally(() => { if (active) setLoadingGuests(false); });
    return () => { active = false; };
  }, [workshopId, accessKey]);

  useEffect(() => {
    let active = true;
    setStatuses({});
    if (!workshopId || !templateId) return;
    void listZbsGuestBulkStatuses(workshopId, templateId)
      .then((data) => { if (active) setStatuses(data); })
      .catch((loadError) => { if (active) setError("Không tải được trạng thái gửi: " + errorMessage(loadError)); });
    return () => { active = false; };
  }, [workshopId, templateId, accessKey]);

  // Theo dõi tiến độ đến khi worker gửi xong mọi tin của lượt.
  useEffect(() => {
    if (!result || (result.counts.pending + result.counts.sending) === 0) return;
    const timer = window.setTimeout(() => {
      void getZbsBulkBatch(result.bulk_id).then(setResult).catch(() => undefined);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [result]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return guests.filter((guest) => {
      if (term && !`${guest.full_name} ${guest.phone || ""}`.toLowerCase().includes(term)) return false;
      if (registrationFilter && guest.registration_status !== registrationFilter) return false;
      if (checkinFilter === "checked_in" && guest.checkin_status !== "checked_in") return false;
      if (checkinFilter === "not_checked_in" && guest.checkin_status === "checked_in") return false;
      const status = statuses[guest.id]?.status;
      if (sendFilter === "not_sent" && status) return false;
      if (sendFilter && sendFilter !== "not_sent" && status !== sendFilter) return false;
      return true;
    });
  }, [checkinFilter, guests, registrationFilter, search, sendFilter, statuses]);

  const selectedSet = new Set(selected);
  const params = template?.detail.listParams || [];
  const requestBody = () => ({
    template_id: templateId,
    workshop_id: workshopId,
    guest_ids: selected,
    params: mapping,
    allow_resend: allowResend,
  });
  const step = result ? 3 : preflight ? 2 : 1;

  const runPreflight = async () => {
    setSubmitting(true);
    setError("");
    try {
      setPreflight(await preflightZbsBulk(requestBody()));
    } catch (preflightError) {
      setError("Kiểm tra trước khi gửi thất bại: " + errorMessage(preflightError));
    } finally {
      setSubmitting(false);
    }
  };

  const send = async () => {
    if (!preflight) return;
    const cost = preflight.estimated_cost !== null ? ` (ước tính ${formatMoney(preflight.estimated_cost)})` : "";
    if (!window.confirm(`Xác nhận gửi mẫu tin ZBS cho ${preflight.eligible_count} khách${cost}? Tin đã gửi sẽ bị tính phí và không thu hồi được.`)) return;
    setSubmitting(true);
    setError("");
    try {
      setResult(await sendZbsBulk({ ...requestBody(), guest_ids: preflight.eligible_guest_ids, bulk_id: bulkIdRef.current }));
      onSent();
    } catch (sendError) {
      setError("Gửi tin thất bại: " + errorMessage(sendError));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleAllFiltered = (checked: boolean) => {
    resetPreflight();
    const ids = filtered.map((guest) => guest.id);
    setSelected(checked ? Array.from(new Set([...selected, ...ids])) : selected.filter((id) => !ids.includes(id)));
  };

  const fieldClass = "mt-1 min-h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal outline-none focus:border-brand disabled:bg-gray-100";
  const steps = [
    { n: 1, label: "Chọn mẫu tin & khách" },
    { n: 2, label: "Kiểm tra" },
    { n: 3, label: "Kết quả" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Gửi tin ZBS hàng loạt"
      onClick={(event) => { if (event.target === event.currentTarget) handleClose(); }}
    >
      <div className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-xl bg-white shadow-xl sm:rounded-xl">
        <header className="border-b border-line px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-lg font-bold text-ink">Gửi tin ZBS hàng loạt</h2>
              <p className="text-xs text-muted">Chọn mẫu tin, workshop và khách mời; kiểm tra tham số rồi xếp hàng gửi qua Zalo Business Solutions.</p>
            </div>
            <button type="button" onClick={handleClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-muted" aria-label="Đóng">
              <XMarkIcon className="h-6 w-6" aria-hidden />
            </button>
          </div>
          <ol className="mt-4 flex flex-wrap gap-2" aria-label="Các bước gửi tin">
            {steps.map((item) => {
              const active = step === item.n;
              const done = step > item.n;
              return (
                <li key={item.n} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-brand/15 text-brand-teal" : done ? "bg-green-50 text-green-700" : "bg-surface-muted text-muted"}`}>
                  <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${active || done ? "bg-brand text-brand-teal" : "bg-white text-muted"}`}>
                    {done ? <CheckCircleIcon className="h-3.5 w-3.5" aria-hidden /> : item.n}
                  </span>
                  {item.label}
                </li>
              );
            })}
          </ol>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {error && <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-error">{error}</div>}
          {options && !options.system_enabled && !result && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">ZBS đang tắt ở cấu hình hệ thống (`ZBS_ENABLED`). Có thể kiểm tra danh sách nhưng chưa thể gửi.</div>
          )}

          {result ? (
            <div className="space-y-5">
              <div className="rounded-lg border border-success-border bg-success-soft p-5">
                <h3 className="font-heading text-xl font-bold text-success">Đã xếp hàng gửi tin</h3>
                <p className="mt-1 text-sm text-success">
                  {result.template_name} → {result.workshop_name}
                  {(result.counts.pending + result.counts.sending) > 0 ? " · Đang gửi, tiến độ tự cập nhật..." : " · Đã xử lý xong"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {([
                  ["Tổng", result.total, "text-ink"],
                  ["Chờ / đang gửi", result.counts.pending + result.counts.sending, "text-amber-700"],
                  ["Đã gửi", result.counts.sent + result.counts.delivered, "text-green-700"],
                  ["Lỗi", result.counts.failed + result.counts.expired, "text-red-600"],
                  ["Bỏ qua", result.skipped?.length || 0, "text-muted"],
                ] as const).map(([label, value, color]) => (
                  <div key={label} className="rounded-md border border-line p-4 text-center">
                    <div className={`text-2xl font-bold ${color}`}>{value}</div>
                    <div className="text-xs text-muted">{label}</div>
                  </div>
                ))}
              </div>
              {!!result.skipped?.length && (
                <div className="rounded-md border border-line">
                  <div className="border-b border-line bg-surface-muted px-3 py-2 text-xs font-semibold text-muted">Khách bị bỏ qua</div>
                  <ul className="max-h-48 divide-y divide-line overflow-auto text-sm">
                    {result.skipped.map((item) => <li key={item.guest_id} className="flex justify-between gap-3 px-3 py-2"><span className="font-medium">{item.full_name}</span><span className="text-right text-xs text-muted">{item.reason}</span></li>)}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-semibold text-text-secondary">Mẫu tin ZBS
                  <select disabled={submitting} value={templateId} onChange={(event) => setTemplateId(event.target.value)} className={fieldClass}>
                    <option value="">Chọn mẫu tin đã kích hoạt</option>
                    {templates.map((item) => <option key={item.template_id} value={item.template_id}>{item.template_name} ({item.template_id})</option>)}
                  </select>
                </label>
                <label className="text-sm font-semibold text-text-secondary">Workshop
                  <select disabled={submitting} value={workshopId} onChange={(event) => setWorkshopId(event.target.value)} className={fieldClass}>
                    <option value="">Chọn workshop</option>
                    {workshops.map((workshop) => <option key={workshop.id} value={workshop.id}>{workshop.name}</option>)}
                  </select>
                </label>
              </div>
              {!workshops.length && <p className="mt-2 text-xs text-muted">Bạn chưa có workshop nào được quyền quản lý ZBS.</p>}

              {template && (
                <section className="mt-5 rounded-lg border border-line">
                  <div className="flex flex-col gap-1 border-b border-line bg-surface-muted px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-sm font-semibold text-ink">Tham số mẫu tin ({params.length})</h3>
                    <span className="text-xs text-muted">Đơn giá: {formatMoney(template.price_sdt ? Number(template.price_sdt) : null)} / tin</span>
                  </div>
                  {params.length ? (
                    <div className="divide-y divide-line">
                      {params.map((param) => {
                        const entry = mapping[param.name] || { source: FIXED_SOURCE, value: "" };
                        return (
                          <div key={param.name} className="grid gap-2 px-3 py-2 sm:grid-cols-[200px_1fr_1fr] sm:items-center">
                            <div>
                              <div className="font-mono text-xs text-brand-teal">{param.name}</div>
                              <div className="text-[11px] text-muted">{param.type} · tối đa {param.maxLength} ký tự{param.require ? " · bắt buộc" : ""}</div>
                            </div>
                            <select
                              aria-label={`Nguồn dữ liệu cho ${param.name}`}
                              disabled={submitting}
                              value={entry.source}
                              onChange={(event) => { resetPreflight(); setMapping((current) => ({ ...current, [param.name]: { ...entry, source: event.target.value } })); }}
                              className="min-h-10 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-brand"
                            >
                              {(options?.sources || []).map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}
                            </select>
                            {entry.source === FIXED_SOURCE ? (
                              <input
                                aria-label={`Giá trị cố định cho ${param.name}`}
                                disabled={submitting}
                                value={entry.value}
                                maxLength={param.maxLength || undefined}
                                placeholder="Nhập giá trị dùng chung cho mọi khách"
                                onChange={(event) => { resetPreflight(); setMapping((current) => ({ ...current, [param.name]: { ...entry, value: event.target.value } })); }}
                                className="min-h-10 rounded-md border border-line px-3 text-sm outline-none focus:border-brand"
                              />
                            ) : <span className="text-xs text-muted">Lấy theo từng khách / workshop</span>}
                          </div>
                        );
                      })}
                    </div>
                  ) : <p className="px-3 py-4 text-center text-sm text-muted">Mẫu tin không có tham số động.</p>}
                </section>
              )}

              <div className="mt-5 overflow-hidden rounded-lg border border-line">
                <div className="flex flex-col gap-2 border-b border-line bg-surface-muted p-3 lg:flex-row lg:items-center">
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm tên hoặc số điện thoại" aria-label="Tìm khách" className="min-h-10 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-brand lg:w-60" />
                  <div className="grid grid-cols-3 gap-2 lg:flex">
                    <select aria-label="Lọc theo đăng ký" value={registrationFilter} onChange={(event) => setRegistrationFilter(event.target.value)} className="min-h-10 rounded-md border border-line bg-white px-2 text-sm">
                      <option value="">Mọi đăng ký</option>
                      <option value="confirmed">Đã xác nhận</option>
                      <option value="pending">Chờ xác nhận</option>
                    </select>
                    <select aria-label="Lọc theo check-in" value={checkinFilter} onChange={(event) => setCheckinFilter(event.target.value)} className="min-h-10 rounded-md border border-line bg-white px-2 text-sm">
                      <option value="">Mọi check-in</option>
                      <option value="checked_in">Đã check-in</option>
                      <option value="not_checked_in">Chưa check-in</option>
                    </select>
                    <select aria-label="Lọc theo trạng thái gửi" value={sendFilter} onChange={(event) => setSendFilter(event.target.value)} disabled={!templateId} className="min-h-10 rounded-md border border-line bg-white px-2 text-sm disabled:bg-gray-100">
                      <option value="">Mọi trạng thái gửi</option>
                      <option value="not_sent">Chưa gửi mẫu này</option>
                      <option value="sent">Đã gửi</option>
                      <option value="delivered">Đã nhận</option>
                      <option value="failed">Lỗi</option>
                    </select>
                  </div>
                  <div className="text-xs text-muted lg:ml-auto">Đã chọn <strong className="text-ink">{selected.length}</strong>/{guests.length} khách</div>
                </div>
                <div className="max-h-80 overflow-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="sticky top-0 bg-white text-left text-xs text-muted">
                      <tr>
                        <th className="w-12 px-3 py-2">
                          <input type="checkbox" disabled={submitting || loadingGuests || !filtered.length} checked={!!filtered.length && filtered.every((guest) => selectedSet.has(guest.id))} onChange={(event) => toggleAllFiltered(event.target.checked)} aria-label="Chọn tất cả khách đang hiển thị" />
                        </th>
                        <th className="px-3 py-2">Khách</th>
                        <th className="px-3 py-2">Số điện thoại</th>
                        <th className="px-3 py-2">Đăng ký</th>
                        <th className="px-3 py-2">Check-in</th>
                        <th className="px-3 py-2">Mẫu tin này</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {loadingGuests ? (
                        <tr><td colSpan={6} className="p-8 text-center text-muted">Đang tải...</td></tr>
                      ) : filtered.map((guest) => {
                        const status = statuses[guest.id];
                        return (
                          <tr key={guest.id} className={selectedSet.has(guest.id) ? "bg-brand/5" : ""}>
                            <td className="px-3 py-2">
                              <input type="checkbox" disabled={submitting} checked={selectedSet.has(guest.id)} onChange={(event) => { resetPreflight(); setSelected(event.target.checked ? [...selected, guest.id] : selected.filter((id) => id !== guest.id)); }} aria-label={`Chọn ${guest.full_name}`} />
                            </td>
                            <td className="px-3 py-2 font-semibold text-ink">{guest.full_name}</td>
                            <td className="px-3 py-2 font-mono text-xs">{guest.phone || "—"}</td>
                            <td className="px-3 py-2 text-xs">{guest.registration_status === "confirmed" ? "Đã xác nhận" : "Chờ xác nhận"}</td>
                            <td className="px-3 py-2 text-xs">{guest.checkin_status === "checked_in" ? "Đã check-in" : "Chưa"}</td>
                            <td className="px-3 py-2" title={status?.last_error || undefined}>{status ? <StatusBadge status={status.status} /> : <span className="text-xs text-muted">Chưa gửi</span>}</td>
                          </tr>
                        );
                      })}
                      {!loadingGuests && !filtered.length && <tr><td colSpan={6} className="p-8 text-center text-muted">{workshopId ? "Không có khách phù hợp." : "Chọn workshop để xem khách mời."}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
              <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-sm text-text-secondary">
                <input type="checkbox" checked={allowResend} disabled={submitting} onChange={(event) => { resetPreflight(); setAllowResend(event.target.checked); }} />
                Gửi lại cho khách đã nhận hoặc đang chờ gửi mẫu tin này
              </label>

              {preflight && (
                <div className={`mt-4 rounded-md border p-4 ${preflight.can_send ? "border-success-border bg-success-soft" : "border-amber-200 bg-amber-50"}`}>
                  <div className="font-semibold text-ink">Kết quả kiểm tra trước khi gửi</div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    {([
                      ["Tổng chọn", preflight.total],
                      ["Đủ điều kiện", preflight.eligible_count],
                      ["Không hợp lệ", preflight.ineligible_count],
                      ["Chi phí ước tính", formatMoney(preflight.estimated_cost)],
                    ] as const).map(([label, value]) => (
                      <div key={label} className="rounded-md border border-white/60 bg-white/70 px-3 py-2">
                        <div className="text-xs text-muted">{label}</div>
                        <div className="mt-0.5 text-lg font-bold text-ink">{value}</div>
                      </div>
                    ))}
                  </div>
                  {!!preflight.mapping_errors.length && (
                    <ul className="mt-3 list-disc pl-5 text-xs text-red-700">{preflight.mapping_errors.map((item) => <li key={item}>{item}</li>)}</ul>
                  )}
                  {(() => {
                    const sample = preflight.recipients.find((item) => item.eligible);
                    return sample && Object.keys(sample.template_data).length > 0 && (
                      <div className="mt-3 rounded-md border border-white/60 bg-white/70 p-3 text-xs">
                        <div className="font-semibold text-ink">Dữ liệu mẫu — {sample.full_name}</div>
                        <dl className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                          {Object.entries(sample.template_data).map(([key, value]) => <div key={key} className="flex gap-2"><dt className="font-mono text-brand-teal">{key}</dt><dd className="truncate text-ink">{String(value)}</dd></div>)}
                        </dl>
                      </div>
                    );
                  })()}
                  {preflight.ineligible_count > 0 && (
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer font-semibold text-amber-800">Xem {preflight.ineligible_count} khách không hợp lệ</summary>
                      <ul className="mt-2 max-h-40 divide-y divide-amber-100 overflow-auto rounded border border-amber-200 bg-white">
                        {preflight.recipients.filter((item) => !item.eligible).map((item) => <li key={item.guest_id} className="flex justify-between gap-3 px-3 py-1.5"><span>{item.full_name}</span><span className="text-right text-xs text-muted">{item.reason}</span></li>)}
                      </ul>
                    </details>
                  )}
                  {!preflight.system_enabled && <p className="mt-3 text-xs text-amber-800">ZBS đang tắt ở cấu hình hệ thống nên chưa thể gửi.</p>}
                </div>
              )}
            </>
          )}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3 sm:px-5">
          <button type="button" onClick={handleClose} className="min-h-10 rounded-md border border-line px-4 text-sm font-semibold transition hover:bg-surface-muted">{result ? "Đóng" : "Hủy"}</button>
          {!result && !preflight && (
            <button type="button" disabled={!template || !workshopId || !selected.length || submitting} onClick={() => void runPreflight()} className="min-h-10 rounded-md bg-brand px-5 text-sm font-semibold text-brand-teal transition hover:bg-brand-accent disabled:opacity-40">
              {submitting ? "Đang kiểm tra..." : `Kiểm tra ${selected.length} khách`}
            </button>
          )}
          {!result && preflight && (
            <>
              <button type="button" disabled={submitting} onClick={resetPreflight} className="min-h-10 rounded-md border border-brand px-4 text-sm font-semibold text-brand transition hover:bg-brand/5">Chọn lại</button>
              <button type="button" disabled={!preflight.can_send || submitting} onClick={() => void send()} className="min-h-10 rounded-md bg-brand px-5 text-sm font-semibold text-brand-teal transition hover:bg-brand-accent disabled:opacity-40">
                {submitting ? "Đang gửi..." : `Gửi ${preflight.eligible_count} tin ZBS`}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
