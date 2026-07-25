"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowPathIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { getZaloDelivery, listZaloDeliveries } from "@/lib/api";
import ZaloDeliveryModal from "@/components/ZaloDeliveryModal";
import type { ZaloDelivery, ZaloMessageTemplate } from "@/types/zalo-message";
import { useModalDismiss } from "./useModalDismiss";
import { errorMessage, formatDateTime } from "./utils";

function statusClass(status: string, failedCount: number) {
  if (failedCount > 0 || status === "failed")
    return "bg-red-50 text-red-700";
  if (status === "sent" || status === "delivered" || status === "completed")
    return "bg-green-50 text-green-700";
  if (status === "pending" || status === "sending" || status === "queued")
    return "bg-amber-50 text-amber-800";
  return "bg-surface-muted text-muted";
}

export default function TemplateDeliveryHistory({
  template,
  canSend,
  onClose,
}: {
  template: ZaloMessageTemplate;
  canSend: boolean;
  onClose: () => void;
}) {
  const [deliveries, setDeliveries] = useState<ZaloDelivery[]>([]);
  const [detail, setDetail] = useState<ZaloDelivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const handleClose = useCallback(() => {
    if (detail) {
      setDetail(null);
      return;
    }
    onClose();
  }, [detail, onClose]);
  useModalDismiss(handleClose);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDeliveries(await listZaloDeliveries(undefined, 0, 100, template.id));
    } catch (loadError) {
      setError("Không tải được lịch sử gửi: " + errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [template.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshDetail = async () => {
    if (!detail) return;
    try {
      setDetail(await getZaloDelivery(detail.id));
      await load();
    } catch (refreshError) {
      setError(
        "Không tải được chi tiết delivery: " + errorMessage(refreshError),
      );
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-label={`Lịch sử gửi ${template.name}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) handleClose();
        }}
      >
        <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-heading text-lg font-bold text-ink">
                Lịch sử gửi
              </h3>
              <p className="mt-1 text-sm text-muted">{template.name}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-10 w-10 place-items-center rounded-full text-muted transition hover:bg-surface-muted"
              aria-label="Đóng"
            >
              <XMarkIcon className="h-6 w-6" aria-hidden />
            </button>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-sm text-muted">
              {deliveries.length} delivery gần nhất
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex min-h-9 items-center gap-1.5 rounded border border-line px-3 text-xs font-semibold text-brand-teal transition hover:bg-brand/5 disabled:opacity-50"
            >
              <ArrowPathIcon
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                aria-hidden
              />
              {loading ? "Đang tải..." : "Làm mới"}
            </button>
          </div>
          {error && (
            <div
              role="alert"
              className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-error"
            >
              {error}
            </div>
          )}
          {!loading && !deliveries.length && (
            <div className="mt-4 rounded border border-dashed border-line p-8 text-center text-sm text-muted">
              Mẫu tin này chưa có delivery.
            </div>
          )}
          <div className="mt-4 space-y-2">
            {deliveries.map((delivery) => (
              <button
                type="button"
                key={delivery.id}
                onClick={() =>
                  void getZaloDelivery(delivery.id)
                    .then(setDetail)
                    .catch((detailError) =>
                      setError(
                        "Không tải được chi tiết delivery: " +
                          errorMessage(detailError),
                      ),
                    )
                }
                className="block w-full rounded border border-line p-3 text-left transition hover:bg-brand/5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm text-ink">
                    {formatDateTime(delivery.created_at)}
                  </strong>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass(delivery.status, delivery.failed_count)}`}
                  >
                    {delivery.status}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted">
                  {delivery.recipient_count} người nhận · {delivery.sent_count}{" "}
                  đã gửi · {delivery.failed_count} lỗi · Xem chi tiết
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
      {detail && (
        <ZaloDeliveryModal
          delivery={detail}
          canSend={canSend}
          onClose={() => setDetail(null)}
          onChanged={() => void refreshDetail()}
        />
      )}
    </>
  );
}
