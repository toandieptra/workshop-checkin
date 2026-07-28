"use client";

import type { ZaloMessageQuota } from "@/types/zalo-message";
import { formatDateTime } from "./utils";

export default function QuotaCard({ quota }: { quota: ZaloMessageQuota }) {
  const quotaPercent = quota.limit
    ? Math.min(100, Math.round((quota.used / quota.limit) * 100))
    : 0;
  const barClass =
    quotaPercent >= 90
      ? "bg-red-500"
      : quotaPercent >= 70
        ? "bg-amber-500"
        : "bg-brand";

  return (
    <section className="mb-5 shrink-0 rounded-lg border border-line bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-muted">
            Quota gửi tin
          </div>
          <div className="mt-1 flex items-end gap-2">
            <strong className="font-heading text-3xl text-brand-teal">
              {quota.remaining.toLocaleString("vi-VN")}
            </strong>
            <span className="pb-1 text-sm text-muted">tin còn lại</span>
          </div>
        </div>
        <div className="w-full max-w-md">
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>
              Đã dùng {quota.used.toLocaleString("vi-VN")}/
              {quota.limit.toLocaleString("vi-VN")}
            </span>
            <span>{quotaPercent}%</span>
          </div>
          <div
            className="h-2.5 overflow-hidden rounded-full bg-surface-muted"
            role="progressbar"
            aria-valuenow={quota.used}
            aria-valuemin={0}
            aria-valuemax={quota.limit || 100}
            aria-label="Mức sử dụng quota gửi tin"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-200 ${barClass}`}
              style={{ width: `${quotaPercent}%` }}
            />
          </div>
          <div className="mt-1 text-right text-xs text-muted">
            Làm mới: {formatDateTime(quota.resets_at)}
          </div>
        </div>
      </div>
    </section>
  );
}
