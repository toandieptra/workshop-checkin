"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  api,
  listZaloGuestSendStatuses,
  preflightZaloBulkMessage,
  sendZaloBulkMessage,
} from "@/lib/api";
import type { Guest, Workshop } from "@/hooks/useAdminGuests";
import type {
  ZaloBulkPreflight,
  ZaloBulkSendResult,
  ZaloGuestSendStatus,
  ZaloMessageTemplate,
} from "@/types/zalo-message";
import { useModalDismiss } from "./useModalDismiss";
import { errorMessage } from "./utils";

export default function BulkSendModal({
  templates,
  onClose,
  onSent,
}: {
  templates: ZaloMessageTemplate[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [sendStatuses, setSendStatuses] = useState<Record<string, ZaloGuestSendStatus>>({});
  const [templateId, setTemplateId] = useState(
    templates.find((template) => template.status === "active")?.id || "",
  );
  const [workshopId, setWorkshopId] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [preflight, setPreflight] = useState<ZaloBulkPreflight | null>(null);
  const [result, setResult] = useState<ZaloBulkSendResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleClose = useCallback(() => {
    if (submitting) return;
    if (
      !result &&
      selected.length > 0 &&
      !window.confirm("Đang chọn khách — đóng cửa sổ gửi hàng loạt?")
    ) {
      return;
    }
    onClose();
  }, [onClose, result, selected.length, submitting]);
  useModalDismiss(handleClose);

  useEffect(() => {
    void api<Workshop[]>("/workshops")
      .then((data) => {
        setWorkshops(data);
        setWorkshopId(data[0]?.id || "");
      })
      .catch((loadError) =>
        setError("Không tải được workshop: " + errorMessage(loadError)),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!workshopId) {
      setGuests([]);
      setSendStatuses({});
      return;
    }
    setLoading(true);
    setPreflight(null);
    setSelected([]);
    void api<Guest[]>(
      `/workshops/${encodeURIComponent(workshopId)}/guests?sort_registered_at=desc`,
    )
      .then(setGuests)
      .catch((loadError) =>
        setError("Không tải được khách: " + errorMessage(loadError)),
      )
      .finally(() => setLoading(false));
  }, [workshopId]);

  useEffect(() => {
    setSendStatuses({});
    if (!workshopId || !templateId) return;
    let cancelled = false;
    void listZaloGuestSendStatuses(workshopId, templateId)
      .then((statuses) => {
        if (!cancelled) {
          setSendStatuses(
            Object.fromEntries(statuses.map((status) => [status.guest_id, status])),
          );
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError("Không tải được trạng thái gửi: " + errorMessage(loadError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [templateId, workshopId]);

  const filtered = guests.filter((guest) =>
    `${guest.full_name} ${guest.phone || ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const selectedSet = new Set(selected);
  const eligibleCount = preflight?.eligible_count || 0;
  const step = result ? 3 : preflight ? 2 : 1;

  const runPreflight = async () => {
    setSubmitting(true);
    setError("");
    try {
      setPreflight(
        await preflightZaloBulkMessage({
          template_id: templateId,
          workshop_id: workshopId,
          guest_ids: selected,
        }),
      );
    } catch (preflightError) {
      setError(
        "Kiểm tra trước khi gửi thất bại: " + errorMessage(preflightError),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const send = async () => {
    if (
      !preflight ||
      !window.confirm(
        `Xác nhận xếp hàng gửi mẫu tin cho ${selected.length} khách đã chọn?`,
      )
    )
      return;
    setSubmitting(true);
    setError("");
    try {
      setResult(
        await sendZaloBulkMessage({
          template_id: templateId,
          guest_ids: selected,
        }),
      );
      onSent();
    } catch (sendError) {
      setError("Gửi tin thất bại: " + errorMessage(sendError));
    } finally {
      setSubmitting(false);
    }
  };

  const steps = [
    { n: 1, label: "Chọn khách" },
    { n: 2, label: "Kiểm tra" },
    { n: 3, label: "Kết quả" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Gửi tin Zalo hàng loạt"
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div className="flex max-h-[95vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-xl bg-white shadow-xl sm:rounded-xl">
        <header className="border-b border-line px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-lg font-bold text-ink">
                Gửi tin Zalo hàng loạt
              </h2>
              <p className="text-xs text-muted">
                Chọn khách, kiểm tra điều kiện, xác nhận và theo dõi kết quả.
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-muted"
              aria-label="Đóng"
            >
              <XMarkIcon className="h-6 w-6" aria-hidden />
            </button>
          </div>
          <ol className="mt-4 flex flex-wrap gap-2" aria-label="Các bước gửi tin">
            {steps.map((item) => {
              const active = step === item.n;
              const done = step > item.n;
              return (
                <li
                  key={item.n}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                    active
                      ? "bg-brand/15 text-brand-teal"
                      : done
                        ? "bg-green-50 text-green-700"
                        : "bg-surface-muted text-muted"
                  }`}
                >
                  <span
                    className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${
                      active || done
                        ? "bg-brand text-brand-teal"
                        : "bg-white text-muted"
                    }`}
                  >
                    {done ? (
                      <CheckCircleIcon className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      item.n
                    )}
                  </span>
                  {item.label}
                </li>
              );
            })}
          </ol>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-error"
            >
              {error}
            </div>
          )}
          {result ? (
            <div className="space-y-5">
              <div className="rounded-lg border border-success-border bg-success-soft p-5">
                <h3 className="font-heading text-xl font-bold text-success">
                  Đã xếp hàng gửi tin
                </h3>
                <p className="mt-1 text-sm text-success">
                  Delivery ID:{" "}
                  <span className="font-mono">{result.batch_id}</span> · Trạng
                  thái: {result.status}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Tổng", result.total, "text-ink"],
                  ["Đã gửi", result.sent, "text-green-700"],
                  ["Lỗi", result.failed, "text-red-600"],
                  ["Bỏ qua", result.skipped, "text-muted"],
                ].map(([label, value, color]) => (
                  <div
                    key={String(label)}
                    className="rounded-md border border-line p-4 text-center"
                  >
                    <div className={`text-2xl font-bold ${color}`}>{value}</div>
                    <div className="text-xs text-muted">{label}</div>
                  </div>
                ))}
              </div>
              {!!result.results?.length && (
                <div className="overflow-hidden rounded-md border border-line">
                  <div className="max-h-72 overflow-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead className="sticky top-0 bg-surface-muted text-left text-xs text-muted">
                        <tr>
                          <th className="px-3 py-2">Khách</th>
                          <th className="px-3 py-2">Trạng thái</th>
                          <th className="px-3 py-2">Chi tiết</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {result.results.map((item) => (
                          <tr key={item.guest_id}>
                            <td className="px-3 py-2 font-medium">
                              {item.full_name || item.guest_id}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                  item.status === "failed"
                                    ? "bg-red-50 text-red-700"
                                    : item.status === "sent"
                                      ? "bg-green-50 text-green-700"
                                      : "bg-surface-muted text-muted"
                                }`}
                              >
                                {item.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-red-600">
                              {item.error || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-semibold text-text-secondary">
                  Mẫu tin
                  <select
                    value={templateId}
                    onChange={(event) => {
                      setTemplateId(event.target.value);
                      setPreflight(null);
                    }}
                    className="mt-1 min-h-10 w-full rounded-md border border-line bg-white px-3 font-normal outline-none focus:border-brand"
                  >
                    <option value="">Chọn mẫu đang sử dụng</option>
                    {templates
                      .filter((template) => template.status === "active")
                      .map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-text-secondary">
                  Workshop
                  <select
                    value={workshopId}
                    onChange={(event) => setWorkshopId(event.target.value)}
                    className="mt-1 min-h-10 w-full rounded-md border border-line bg-white px-3 font-normal outline-none focus:border-brand"
                  >
                    <option value="">Chọn workshop</option>
                    {workshops.map((workshop) => (
                      <option key={workshop.id} value={workshop.id}>
                        {workshop.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-5 overflow-hidden rounded-lg border border-line">
                <div className="flex flex-col gap-3 border-b border-line bg-surface-muted p-3 sm:flex-row sm:items-center sm:justify-between">
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Tìm tên hoặc số điện thoại"
                    className="min-h-10 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-brand sm:w-72"
                  />
                  <div className="text-xs text-muted">
                    Đã chọn{" "}
                    <strong className="text-ink">{selected.length}</strong>/
                    {guests.length} khách
                  </div>
                </div>
                <div className="max-h-72 overflow-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="sticky top-0 bg-white text-left text-xs text-muted">
                      <tr>
                        <th className="w-12 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={
                              !!filtered.length &&
                              filtered.every((guest) =>
                                selectedSet.has(guest.id),
                              )
                            }
                            onChange={(event) => {
                              setPreflight(null);
                              setSelected(
                                event.target.checked
                                  ? Array.from(
                                      new Set([
                                        ...selected,
                                        ...filtered.map((guest) => guest.id),
                                      ]),
                                    )
                                  : selected.filter(
                                      (id) =>
                                        !filtered.some(
                                          (guest) => guest.id === id,
                                        ),
                                    ),
                              );
                            }}
                            aria-label="Chọn tất cả khách đang hiển thị"
                          />
                        </th>
                        <th className="px-3 py-2">Khách</th>
                        <th className="px-3 py-2">Số điện thoại</th>
                        <th className="px-3 py-2">Trạng thái gửi</th>
                        <th className="px-3 py-2">Trạng thái chọn</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {loading ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="p-8 text-center text-muted"
                          >
                            Đang tải...
                          </td>
                        </tr>
                      ) : (
                        filtered.map((guest) => (
                          <tr
                            key={guest.id}
                            className={
                              selectedSet.has(guest.id) ? "bg-brand/5" : ""
                            }
                          >
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={selectedSet.has(guest.id)}
                                onChange={(event) => {
                                  setPreflight(null);
                                  setSelected(
                                    event.target.checked
                                      ? [...selected, guest.id]
                                      : selected.filter(
                                          (id) => id !== guest.id,
                                        ),
                                  );
                                }}
                                aria-label={`Chọn ${guest.full_name}`}
                              />
                            </td>
                            <td className="px-3 py-2 font-semibold text-ink">
                              {guest.full_name}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {guest.phone || "—"}
                            </td>
                            <td className="px-3 py-2">
                              {(() => {
                                const sendStatus = sendStatuses[guest.id];
                                const status = sendStatus?.status || "not_sent";
                                const label = status === "sent"
                                  ? "Đã gửi"
                                  : status === "failed"
                                    ? "Lỗi"
                                    : "Chưa gửi";
                                return (
                                  <span
                                    title={sendStatus?.last_error || undefined}
                                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                      status === "sent"
                                        ? "bg-green-50 text-green-700"
                                        : status === "failed"
                                          ? "bg-red-50 text-red-700"
                                          : "bg-surface-muted text-muted"
                                    }`}
                                  >
                                    {label}
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`text-xs font-semibold ${
                                  selectedSet.has(guest.id)
                                    ? "text-brand-teal"
                                    : "text-muted"
                                }`}
                              >
                                {selectedSet.has(guest.id)
                                  ? "Đã chọn"
                                  : "Chưa chọn"}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                      {!loading && !filtered.length && (
                        <tr>
                          <td
                            colSpan={5}
                            className="p-8 text-center text-muted"
                          >
                            Không có khách phù hợp.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              {preflight && (
                <div
                  className={`mt-4 rounded-md border p-4 ${
                    preflight.can_send
                      ? "border-success-border bg-success-soft"
                      : "border-amber-200 bg-amber-50"
                  }`}
                >
                  <div className="font-semibold text-ink">
                    Kết quả kiểm tra trước khi gửi
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    {[
                      ["Tổng chọn", preflight.total],
                      ["Đủ điều kiện", preflight.eligible_count],
                      ["Không hợp lệ", preflight.ineligible_count],
                      ["Quota còn", preflight.quota_remaining],
                    ].map(([label, value]) => (
                      <div
                        key={String(label)}
                        className="rounded-md border border-white/60 bg-white/70 px-3 py-2"
                      >
                        <div className="text-xs text-muted">{label}</div>
                        <div className="mt-0.5 text-lg font-bold text-ink">
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>
                  {!preflight.can_send && (
                    <p className="mt-3 text-xs text-amber-800">
                      Chưa thể gửi: kiểm tra quota hoặc điều kiện người nhận.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={handleClose}
            className="min-h-10 rounded-md border border-line px-4 text-sm font-semibold transition hover:bg-surface-muted"
          >
            {result ? "Đóng" : "Hủy"}
          </button>
          {!result && !preflight && (
            <button
              type="button"
              disabled={
                !templateId || !workshopId || !selected.length || submitting
              }
              onClick={() => void runPreflight()}
              className="min-h-10 rounded-md bg-brand px-5 text-sm font-semibold text-brand-teal transition hover:bg-brand-accent disabled:opacity-40"
            >
              {submitting ? "Đang kiểm tra..." : "Kiểm tra trước khi gửi"}
            </button>
          )}
          {!result && preflight && (
            <>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setPreflight(null)}
                className="min-h-10 rounded-md border border-brand px-4 text-sm font-semibold text-brand transition hover:bg-brand/5"
              >
                Chọn lại
              </button>
              <button
                type="button"
                disabled={
                  !preflight.can_send ||
                  !eligibleCount ||
                  selected.length > preflight.quota_remaining ||
                  submitting
                }
                onClick={() => void send()}
                className="min-h-10 rounded-md bg-brand px-5 text-sm font-semibold text-brand-teal transition hover:bg-brand-accent disabled:opacity-40"
              >
                {submitting
                  ? "Đang gửi..."
                  : `Xác nhận xếp hàng ${selected.length} khách`}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
