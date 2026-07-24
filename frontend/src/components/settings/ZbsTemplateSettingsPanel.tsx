"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getZbsTemplate,
  listZbsTaskConfigs,
  listZbsTemplates,
  syncZbsTemplates,
  updateZbsTaskConfig,
} from "@/lib/api";
import { PERMISSIONS } from "@/lib/permissions";
import { useAuth } from "@/contexts/AuthContext";
import type {
  ZbsTaskConfig,
  ZbsTemplateDetail,
  ZbsTemplateListItem,
  ZbsTemplateQuality,
  ZbsTemplateStatus,
} from "@/types/zbs-template";

const PAGE_SIZE = 20;
const STATUS_OPTIONS: Array<{ value: ZbsTemplateStatus | ""; label: string }> = [
  { value: "", label: "Tất cả trạng thái" },
  { value: "ENABLE", label: "Đã kích hoạt" },
  { value: "PENDING_REVIEW", label: "Đang chờ duyệt" },
  { value: "REJECT", label: "Bị từ chối" },
  { value: "DISABLE", label: "Đã vô hiệu hóa" },
  { value: "DELETE", label: "Đã xóa" },
];

const STATUS_META: Record<ZbsTemplateStatus, { label: string; className: string }> = {
  ENABLE: { label: "Đã kích hoạt", className: "bg-green-50 text-green-700" },
  PENDING_REVIEW: { label: "Đang chờ duyệt", className: "bg-amber-50 text-amber-700" },
  REJECT: { label: "Bị từ chối", className: "bg-red-50 text-red-700" },
  DISABLE: { label: "Đã vô hiệu hóa", className: "bg-gray-100 text-gray-600" },
  DELETE: { label: "Đã xóa", className: "bg-gray-100 text-gray-500" },
};

const QUALITY_META: Record<ZbsTemplateQuality, { label: string; className: string }> = {
  HIGH: { label: "Tốt", className: "text-green-700" },
  MEDIUM: { label: "Trung bình", className: "text-amber-700" },
  LOW: { label: "Thấp", className: "text-red-700" },
  UNDEFINED: { label: "Chưa đánh giá", className: "text-muted" },
};

const TYPE_LABELS: Record<number, string> = {
  1: "Tùy chỉnh",
  2: "Xác thực",
  3: "Yêu cầu thanh toán",
  4: "Voucher",
  5: "Đánh giá dịch vụ",
};

const TAG_LABELS: Record<string, string> = {
  TRANSACTION: "Giao dịch",
  IN_TRANSACTION: "Giao dịch",
  CUSTOMER_CARE: "Chăm sóc khách hàng",
  PROMOTION: "Khuyến mãi",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "không rõ";
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}

async function listAllEnabledTemplates(): Promise<ZbsTemplateListItem[]> {
  const firstPage = await listZbsTemplates({ offset: 0, limit: 100, status: "ENABLE" });
  const templates = [...firstPage.data];
  for (let offset = 100; offset < firstPage.metadata.total; offset += 100) {
    const nextPage = await listZbsTemplates({ offset, limit: 100, status: "ENABLE" });
    templates.push(...nextPage.data);
  }
  return templates;
}

function DetailModal({ detail, loading, onClose }: {
  detail: ZbsTemplateDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Chi tiết mẫu tin">
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white shadow-xl sm:max-w-2xl sm:rounded-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-white px-5 py-4">
          <div>
            <h2 className="font-heading text-lg font-bold text-ink">Chi tiết mẫu tin</h2>
            {detail && <p className="mt-0.5 font-mono text-xs text-muted">{detail.template_id}</p>}
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full text-2xl text-muted hover:bg-surface-muted" aria-label="Đóng">×</button>
        </div>
        {loading ? (
          <div className="space-y-3 p-5" aria-label="Đang tải chi tiết">
            {[1, 2, 3, 4].map((item) => <div key={item} className="h-12 animate-pulse rounded bg-surface-muted" />)}
          </div>
        ) : detail ? (
          <div className="space-y-5 p-5 text-sm">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">Tên mẫu tin</div>
              <div className="mt-1 text-base font-semibold text-ink">{detail.template_name}</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md bg-surface-muted p-3"><span className="text-muted">Trạng thái:</span> <strong>{STATUS_META[detail.status]?.label || detail.status}</strong></div>
              <div className="rounded-md bg-surface-muted p-3"><span className="text-muted">Chất lượng:</span> <strong>{detail.quality ? QUALITY_META[detail.quality]?.label : "Chưa đánh giá"}</strong></div>
              <div className="rounded-md bg-surface-muted p-3"><span className="text-muted">Nhóm nội dung:</span> <strong>{detail.tag ? TAG_LABELS[detail.tag] || detail.tag : "—"}</strong></div>
              <div className="rounded-md bg-surface-muted p-3"><span className="text-muted">Loại:</span> <strong>{detail.template_type ? TYPE_LABELS[detail.template_type] : "—"}</strong></div>
            </div>
            {detail.detail.reason && <div className="rounded-md border border-amber-200 bg-amber-50 p-3"><strong>Lý do trạng thái:</strong> {detail.detail.reason}</div>}
            <section>
              <h3 className="font-semibold text-ink">Tham số ({detail.detail.listParams?.length || 0})</h3>
              <div className="mt-2 overflow-hidden rounded-md border border-line">
                {(detail.detail.listParams || []).map((parameter) => (
                  <div key={parameter.name} className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 last:border-b-0">
                    <span className="font-mono text-xs text-brand-teal">{parameter.name}</span>
                    <span className="text-xs text-muted">{parameter.type} · {parameter.minLength}-{parameter.maxLength} ký tự{parameter.require ? " · Bắt buộc" : ""}</span>
                  </div>
                ))}
                {!detail.detail.listParams?.length && <div className="px-3 py-4 text-center text-muted">Mẫu tin không có tham số động.</div>}
              </div>
            </section>
            <section>
              <h3 className="font-semibold text-ink">Nút thao tác ({detail.detail.listButtons?.length || 0})</h3>
              <div className="mt-2 space-y-2">
                {(detail.detail.listButtons || []).map((button, index) => (
                  <div key={`${button.type}-${index}`} className="rounded-md border border-line px-3 py-2">
                    <div className="font-medium text-ink">{button.title}</div>
                    <div className="mt-0.5 break-all text-xs text-muted">{button.content}</div>
                  </div>
                ))}
                {!detail.detail.listButtons?.length && <div className="rounded-md border border-line px-3 py-4 text-center text-muted">Mẫu tin không có nút thao tác.</div>}
              </div>
            </section>
            {detail.preview_url && <a href={detail.preview_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center rounded-md border border-brand px-4 font-semibold text-brand hover:bg-brand/5">Mở bản xem trước</a>}
          </div>
        ) : <div className="p-8 text-center text-error">Không tải được chi tiết template.</div>}
      </div>
    </div>
  );
}

export default function ZbsTemplateSettingsPanel() {
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.zbsManage);
  const [templates, setTemplates] = useState<ZbsTemplateListItem[]>([]);
  const [enabledTemplates, setEnabledTemplates] = useState<ZbsTemplateListItem[]>([]);
  const [taskConfigs, setTaskConfigs] = useState<ZbsTaskConfig[]>([]);
  const [taskDrafts, setTaskDrafts] = useState<Record<string, { enabled: boolean; templateId: string }>>({});
  const [status, setStatus] = useState<ZbsTemplateStatus | "">("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<ZbsTemplateDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [list, enabled, configs] = await Promise.all([
        listZbsTemplates({ offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE, status, search }),
        listAllEnabledTemplates(),
        listZbsTaskConfigs(),
      ]);
      setTemplates(list.data);
      setTotal(list.metadata.total);
      setLastSyncedAt(list.metadata.last_synced_at);
      setEnabledTemplates(enabled);
      setTaskConfigs(configs);
      setTaskDrafts(Object.fromEntries(configs.map((config) => [config.task_key, {
        enabled: config.enabled,
        templateId: config.template_id || "",
      }])));
    } catch (loadError) {
      setError("Không tải được dữ liệu ZBS: " + errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  useEffect(() => { void load(); }, [load]);

  const synchronize = async () => {
    setSyncing(true);
    setMessage("");
    setError("");
    try {
      const result = await syncZbsTemplates();
      setMessage(`${result.message}. Thêm mới ${result.created}, cập nhật ${result.updated}.`);
      setPage(1);
      await load();
    } catch (syncError) {
      setError("Đồng bộ thất bại: " + errorMessage(syncError));
    } finally {
      setSyncing(false);
    }
  };

  const saveConfig = async (taskConfig: ZbsTaskConfig) => {
    const draft = taskDrafts[taskConfig.task_key];
    if (!draft) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const updated = await updateZbsTaskConfig(taskConfig.task_key, {
        enabled: draft.enabled,
        template_id: draft.templateId || null,
      });
      setTaskConfigs((current) => current.map((config) => config.task_key === updated.task_key ? updated : config));
      setMessage(`Đã lưu cấu hình “${updated.task_label}”.`);
    } catch (saveError) {
      setError("Không thể lưu cấu hình: " + errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (templateId: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await getZbsTemplate(templateId));
    } catch (detailError) {
      setError("Không tải được chi tiết template: " + errorMessage(detailError));
    } finally {
      setDetailLoading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-accent">Zalo Business Solutions</p>
          <h1 className="font-heading mt-1 text-2xl font-bold text-ink">Quản lý mẫu tin ZBS</h1>
          <p className="mt-1 text-sm text-muted">Cấu hình gửi tự động và lưu bản sao danh sách mẫu tin từ Zalo.</p>
        </div>
        {canManage && <button type="button" onClick={() => void synchronize()} disabled={syncing} className="min-h-10 rounded-md bg-brand px-4 text-sm font-semibold text-brand-teal disabled:opacity-50">{syncing ? "Đang đồng bộ..." : "Đồng bộ từ Zalo"}</button>}
      </div>

      {message && <div className="mb-4 flex items-center justify-between rounded-md border border-success-border bg-success-soft px-4 py-3 text-sm text-success"><span>{message}</span><button onClick={() => setMessage("")} aria-label="Đóng thông báo">×</button></div>}
      {error && <div className="mb-4 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-error"><span>{error}</span><button onClick={() => setError("")} aria-label="Đóng lỗi">×</button></div>}

      <section className="mb-5 rounded-lg border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-heading text-lg font-bold text-ink">Cấu hình gửi tự động</h2>
            <p className="text-sm text-muted">Gắn mẫu tin với tác vụ và chủ động bật hoặc tắt việc gửi tin.</p>
          </div>
          {!!taskConfigs.length && <span className={`mt-2 w-fit rounded-full px-2.5 py-1 text-xs font-semibold sm:mt-0 ${taskConfigs[0].system_enabled ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>Hệ thống ZBS: {taskConfigs[0].system_enabled ? "Đang bật" : "Đang tắt"}</span>}
        </div>
        {loading && !taskConfigs.length ? <div className="mt-5 h-40 animate-pulse rounded-md bg-surface-muted" /> : taskConfigs.length ? (
          <div className="mt-5 space-y-3">
            {taskConfigs.map((taskConfig) => {
              const draft = taskDrafts[taskConfig.task_key] || { enabled: false, templateId: "" };
              const selectedTemplate = templates.find((template) => template.template_id === draft.templateId)
                || enabledTemplates.find((template) => template.template_id === draft.templateId);
              const selectedStatus = selectedTemplate?.status || taskConfig.template_status;
              const selectedName = selectedTemplate?.template_name || taskConfig.template_name;
              const configDirty = draft.enabled !== taskConfig.enabled || draft.templateId !== (taskConfig.template_id || "");
              return <div key={taskConfig.task_key} className="grid gap-5 rounded-md border border-line bg-[#f8fbfb] p-4 lg:grid-cols-[1fr_280px_auto] lg:items-end">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">Tác vụ</div>
                  <div className="mt-1 font-semibold text-ink">{taskConfig.task_label}</div>
                  <label className={`mt-4 flex w-fit items-center gap-3 ${canManage ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
                    <input type="checkbox" className="peer sr-only" checked={draft.enabled} disabled={!canManage || !taskConfig.system_enabled} onChange={(event) => setTaskDrafts((current) => ({ ...current, [taskConfig.task_key]: { ...draft, enabled: event.target.checked } }))} />
                    <span className={`relative h-6 w-11 rounded-full transition ${draft.enabled ? "bg-brand" : "bg-gray-300"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${draft.enabled ? "left-[22px]" : "left-0.5"}`} /></span>
                    <span className="text-sm font-medium text-text-primary">Tự động gửi ZBS khi tác vụ hoàn tất</span>
                  </label>
                  {selectedStatus && selectedStatus !== "ENABLE" && <p className="mt-2 text-xs text-amber-700">Mẫu tin đang ở trạng thái {STATUS_META[selectedStatus]?.label || selectedStatus}; chưa thể bật tự động gửi.</p>}
                  {!taskConfig.system_enabled && <p className="mt-2 text-xs text-red-700">Cần bật `ZBS_ENABLED` ở backend trước khi kích hoạt tác vụ.</p>}
                </div>
                <label className="block text-sm font-semibold text-text-secondary">Mẫu tin sử dụng
                  <select value={draft.templateId} disabled={!canManage} onChange={(event) => setTaskDrafts((current) => ({ ...current, [taskConfig.task_key]: { ...draft, templateId: event.target.value } }))} className="mt-1 min-h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-brand disabled:bg-gray-100">
                    <option value="">Chọn mẫu tin đã kích hoạt</option>
                    {taskConfig.template_id && !enabledTemplates.some((template) => template.template_id === taskConfig.template_id) && <option value={taskConfig.template_id}>{selectedName || "Mẫu tin đang chờ duyệt"} ({taskConfig.template_id})</option>}
                    {enabledTemplates.map((template) => <option key={template.template_id} value={template.template_id}>{template.template_name} ({template.template_id})</option>)}
                  </select>
                </label>
                {canManage && <button type="button" onClick={() => void saveConfig(taskConfig)} disabled={!configDirty || saving || (draft.enabled && (!draft.templateId || selectedStatus !== "ENABLE"))} className="min-h-10 rounded-md bg-brand px-5 text-sm font-semibold text-brand-teal disabled:opacity-40">{saving ? "Đang lưu..." : "Lưu cấu hình"}</button>}
              </div>;
            })}
          </div>
        ) : <div className="mt-5 rounded-md border border-line p-5 text-center text-muted">Không tải được cấu hình tác vụ.</div>}
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        <div className="border-b border-line px-4 py-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="font-heading font-bold text-ink">Danh sách mẫu tin đã đồng bộ</h2><p className="mt-0.5 text-xs text-muted">Đồng bộ gần nhất: {formatDateTime(lastSyncedAt)}</p></div>
            <div className="mt-3 flex flex-col gap-2 sm:mt-0 sm:flex-row">
              <form onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchInput); }} className="flex">
                <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Tìm theo tên hoặc mã mẫu tin" className="min-h-10 min-w-0 rounded-l-md border border-line px-3 text-sm outline-none focus:border-brand sm:w-64" />
                <button type="submit" className="rounded-r-md border border-l-0 border-line px-3 text-sm font-semibold text-brand-teal">Tìm</button>
              </form>
              <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value as ZbsTemplateStatus | ""); }} className="min-h-10 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-brand">
                {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="admin-table-scroll">
          <table className="min-w-[1000px] w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs text-muted"><tr><th className="px-4 py-3">Mã mẫu tin</th><th className="px-4 py-3">Tên mẫu tin</th><th className="px-4 py-3">Trạng thái</th><th className="px-4 py-3">Chất lượng</th><th className="px-4 py-3">Nhóm nội dung</th><th className="px-4 py-3">Loại</th><th className="px-4 py-3">Ngày tạo</th><th className="px-4 py-3">Thao tác</th></tr></thead>
            <tbody className="divide-y divide-line">
              {loading ? [1, 2, 3, 4, 5].map((row) => <tr key={row}>{[1, 2, 3, 4, 5, 6, 7, 8].map((cell) => <td key={cell} className="px-4 py-4"><div className="h-4 animate-pulse rounded bg-surface-muted" /></td>)}</tr>) : templates.map((template) => {
                const statusMeta = STATUS_META[template.status] || { label: template.status, className: "bg-gray-100 text-gray-600" };
                const qualityMeta = template.quality ? QUALITY_META[template.quality] : null;
                return <tr key={template.template_id} className="hover:bg-brand/5"><td className="px-4 py-3 font-mono text-xs text-muted">{template.template_id}</td><td className="px-4 py-3 font-semibold text-ink">{template.template_name}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusMeta.className}`}>{statusMeta.label}</span></td><td className={`px-4 py-3 font-medium ${qualityMeta?.className || "text-muted"}`}>{qualityMeta?.label || "Chưa đánh giá"}</td><td className="px-4 py-3 text-text-secondary">{template.tag ? TAG_LABELS[template.tag] || template.tag : "—"}</td><td className="px-4 py-3 text-text-secondary">{template.template_type ? TYPE_LABELS[template.template_type] : "—"}</td><td className="px-4 py-3 whitespace-nowrap text-muted">{formatDateTime(template.zalo_created_at)}</td><td className="px-4 py-3"><button type="button" onClick={() => void openDetail(template.template_id)} className="min-h-8 font-semibold text-brand underline">Xem chi tiết</button></td></tr>;
              })}
              {!loading && !templates.length && <tr><td colSpan={8} className="px-4 py-14 text-center"><div className="font-semibold text-ink">Chưa có mẫu tin phù hợp</div><p className="mt-1 text-sm text-muted">Hãy đổi bộ lọc hoặc dùng nút “Đồng bộ từ Zalo” để tạo bản sao.</p></td></tr>}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
          <span className="text-muted">Tổng cộng {total} mẫu tin</span>
          <div className="flex items-center gap-2"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)} className="min-h-9 rounded border border-line px-3 disabled:opacity-40">Trang trước</button><span className="text-muted">Trang {page}/{totalPages}</span><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)} className="min-h-9 rounded border border-line px-3 disabled:opacity-40">Trang sau</button></div>
        </div>
      </section>

      {detailOpen && <DetailModal detail={detail} loading={detailLoading} onClose={() => setDetailOpen(false)} />}
    </div>
  );
}
