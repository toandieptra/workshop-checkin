"use client";

import { useCallback, useEffect, useState } from "react";
import { getZbsBulkBatch, listZbsBulkBatches, retryZbsBulkFailed } from "@/lib/api";
import type { ZbsBulkBatch } from "@/types/zbs-template";
import { StatusBadge } from "./ZbsBulkSendModal";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "không rõ";
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}

export default function ZbsBulkHistory({ refreshKey, canManage }: { refreshKey: number; canManage: boolean }) {
  const [batches, setBatches] = useState<ZbsBulkBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ZbsBulkBatch | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      setBatches(await listZbsBulkBatches());
    } catch (loadError) {
      setError("Không tải được lịch sử gửi: " + errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  // Lượt đang gửi tự cập nhật để thấy tiến độ mà không cần tải lại trang.
  const inProgress = batches.some((batch) => batch.counts.pending + batch.counts.sending > 0);
  useEffect(() => {
    if (!inProgress) return;
    const timer = window.setInterval(() => { void load(); }, 5000);
    return () => window.clearInterval(timer);
  }, [inProgress, load]);

  useEffect(() => { setDetail(null); }, [openId]);

  // Tải lại chi tiết mỗi lần danh sách được làm mới để tiến độ khớp nhau.
  useEffect(() => {
    let active = true;
    if (!openId) return;
    void getZbsBulkBatch(openId)
      .then((data) => { if (active) setDetail(data); })
      .catch((loadError) => { if (active) setError("Không tải được chi tiết lượt gửi: " + errorMessage(loadError)); });
    return () => { active = false; };
  }, [openId, batches]);

  const retryFailed = async (bulkId: string) => {
    if (!window.confirm("Gửi lại toàn bộ tin lỗi của lượt này? Tin gửi thành công sẽ bị tính phí.")) return;
    setRetrying(true);
    setError("");
    try {
      setDetail(await retryZbsBulkFailed(bulkId));
      await load();
    } catch (retryError) {
      setError("Không thể gửi lại: " + errorMessage(retryError));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <section className="mb-5 overflow-hidden rounded-lg border border-line bg-white shadow-sm">
      <div className="border-b border-line px-4 py-4">
        <h2 className="font-heading font-bold text-ink">Lịch sử gửi hàng loạt</h2>
        <p className="mt-0.5 text-xs text-muted">20 lượt gần nhất trong các workshop bạn được xem.</p>
      </div>
      {error && <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-error">{error}</div>}
      <div className="admin-table-scroll">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-surface-muted text-left text-xs text-muted">
            <tr><th className="px-4 py-3">Thời gian</th><th className="px-4 py-3">Mẫu tin</th><th className="px-4 py-3">Workshop</th><th className="px-4 py-3">Người gửi</th><th className="px-4 py-3">Tiến độ</th><th className="px-4 py-3">Thao tác</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-6"><div className="h-4 animate-pulse rounded bg-surface-muted" /></td></tr>
            ) : batches.map((batch) => {
              const done = batch.counts.sent + batch.counts.delivered;
              const failed = batch.counts.failed + batch.counts.expired;
              const waiting = batch.counts.pending + batch.counts.sending;
              const open = openId === batch.bulk_id;
              return [
                <tr key={batch.bulk_id} className={open ? "bg-brand/5" : "hover:bg-brand/5"}>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDateTime(batch.created_at)}</td>
                  <td className="px-4 py-3 font-semibold text-ink">{batch.template_name || batch.template_id}</td>
                  <td className="px-4 py-3 text-text-secondary">{batch.workshop_name || "—"}</td>
                  <td className="px-4 py-3 text-text-secondary">{batch.created_by_name || "—"}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className="font-semibold text-green-700">{done}</span>/{batch.total} đã gửi
                    {failed > 0 && <span className="ml-2 font-semibold text-red-600">{failed} lỗi</span>}
                    {waiting > 0 && <span className="ml-2 font-semibold text-amber-700">{waiting} chờ gửi</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => setOpenId(open ? null : batch.bulk_id)} aria-expanded={open} className="min-h-11 font-semibold text-brand-teal underline">{open ? "Thu gọn" : "Xem chi tiết"}</button>
                  </td>
                </tr>,
                open && (
                  <tr key={`${batch.bulk_id}-detail`}>
                    <td colSpan={6} className="bg-[#f8fbfb] px-4 py-3">
                      {!detail ? <div className="h-16 animate-pulse rounded bg-surface-muted" /> : (
                        <div>
                          {canManage && failed > 0 && (
                            <button type="button" disabled={retrying || !batch.counts.failed} onClick={() => void retryFailed(batch.bulk_id)} className="mb-3 min-h-10 rounded-md border border-brand px-4 text-sm font-semibold text-brand hover:bg-brand/5 disabled:opacity-40">
                              {retrying ? "Đang xếp hàng lại..." : `Gửi lại ${batch.counts.failed} tin lỗi`}
                            </button>
                          )}
                          <div className="max-h-72 overflow-auto rounded-md border border-line bg-white">
                            <table className="w-full text-sm">
                              <thead className="sticky top-0 bg-white text-left text-xs text-muted"><tr><th className="px-3 py-2">Khách</th><th className="px-3 py-2">Số điện thoại</th><th className="px-3 py-2">Trạng thái</th><th className="px-3 py-2">Thời gian gửi</th><th className="px-3 py-2">Lỗi</th></tr></thead>
                              <tbody className="divide-y divide-line">
                                {(detail.items || []).map((item) => (
                                  <tr key={item.id}>
                                    <td className="px-3 py-2 font-medium">{item.full_name || item.guest_id}</td>
                                    <td className="px-3 py-2 font-mono text-xs">{item.phone || "—"}</td>
                                    <td className="px-3 py-2"><StatusBadge status={item.status} /></td>
                                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{formatDateTime(item.sent_time)}</td>
                                    <td className="px-3 py-2 text-xs text-red-600">{item.last_error || "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                ),
              ];
            })}
            {!loading && !batches.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">Chưa có lượt gửi hàng loạt nào.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
