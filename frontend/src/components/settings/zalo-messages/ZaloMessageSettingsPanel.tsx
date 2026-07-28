"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  PlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  cloneZaloMessageTemplate,
  createZaloMessageTemplate,
  deleteZaloMessageTemplate,
  getZaloMessageQuota,
  listZaloMessageTemplates,
  toggleZaloMessageTemplate,
  updateZaloMessageTemplate,
} from "@/lib/api";
import { PERMISSIONS } from "@/lib/permissions";
import { useAuth } from "@/contexts/AuthContext";
import type {
  ZaloMessageQuota,
  ZaloMessageTemplate,
  ZaloMessageTemplateInput,
  ZaloMessageTemplateStatus,
} from "@/types/zalo-message";
import BulkSendModal from "./BulkSendModal";
import EmptyTemplatesState from "./EmptyTemplatesState";
import QuotaCard from "./QuotaCard";
import TemplateDeliveryHistory from "./TemplateDeliveryHistory";
import TemplateEditor from "./TemplateEditor";
import TemplateRowActions from "./TemplateRowActions";
import {
  EMPTY_QUOTA,
  PAGE_SIZE,
  STATUS_META,
  STATUS_OPTIONS,
} from "./constants";
import { errorMessage, formatDateTime } from "./utils";

export default function ZaloMessageSettingsPanel() {
  const { can } = useAuth();
  const hasLegacyTemplateManage = can(PERMISSIONS.zaloTemplatesManage);
  const canCreate =
    hasLegacyTemplateManage || can(PERMISSIONS.zaloTemplatesCreate);
  const canEdit =
    hasLegacyTemplateManage || can(PERMISSIONS.zaloTemplatesEdit);
  const canDelete =
    hasLegacyTemplateManage || can(PERMISSIONS.zaloTemplatesDelete);
  const canReadDeliveries = can(PERMISSIONS.zaloMessagesView);
  const canSend = can(PERMISSIONS.zaloMessagesSend);
  const canBulkSend = canSend || can(PERMISSIONS.zaloMessagesBulkSend);

  const [templates, setTemplates] = useState<ZaloMessageTemplate[]>([]);
  const [quota, setQuota] = useState<ZaloMessageQuota>(EMPTY_QUOTA);
  const [status, setStatus] = useState<ZaloMessageTemplateStatus | "">("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<
    ZaloMessageTemplate | null | undefined
  >(undefined);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [historyTemplate, setHistoryTemplate] =
    useState<ZaloMessageTemplate | null>(null);
  const [autoBusy, setAutoBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const [templateResult, quotaResult] = await Promise.allSettled([
      listZaloMessageTemplates({
        offset: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
        status,
        search,
      }),
      getZaloMessageQuota(),
    ]);
    if (templateResult.status === "fulfilled") {
      setTemplates(templateResult.value.data);
      setTotal(templateResult.value.metadata.total);
    } else
      setError(
        "Không tải được mẫu tin Zalo: " + errorMessage(templateResult.reason),
      );
    if (quotaResult.status === "fulfilled") setQuota(quotaResult.value);
    setLoading(false);
  }, [page, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (input: ZaloMessageTemplateInput) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (editing) await updateZaloMessageTemplate(editing.id, input);
      else await createZaloMessageTemplate(input);
      setMessage(editing ? "Đã cập nhật mẫu tin." : "Đã tạo mẫu tin mới.");
      setEditing(undefined);
      setPage(1);
      await load();
    } catch (saveError) {
      setError("Không thể lưu mẫu tin: " + errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (template: ZaloMessageTemplate) => {
    if (!window.confirm(`Xóa mẫu tin “${template.name}”?`)) return;
    try {
      await deleteZaloMessageTemplate(template.id);
      setMessage("Đã xóa mẫu tin.");
      await load();
    } catch (deleteError) {
      setError("Không thể xóa mẫu tin: " + errorMessage(deleteError));
    }
  };

  const clone = async (template: ZaloMessageTemplate) => {
    try {
      await cloneZaloMessageTemplate(template.id);
      setMessage("Đã nhân bản mẫu tin.");
      await load();
    } catch (cloneError) {
      setError("Không thể nhân bản mẫu tin: " + errorMessage(cloneError));
    }
  };

  const toggle = async (template: ZaloMessageTemplate) => {
    try {
      await toggleZaloMessageTemplate(
        template.id,
        template.status === "active" ? "archived" : "active",
      );
      setMessage("Đã cập nhật trạng thái mẫu tin.");
      await load();
    } catch (toggleError) {
      setError("Không thể cập nhật trạng thái: " + errorMessage(toggleError));
    }
  };

  const toggleAutoSend = async (
    template: ZaloMessageTemplate,
    field: "auto_send_new_guest" | "auto_send_checkin",
    value: boolean,
  ) => {
    const busyKey = `${template.id}:${field}`;
    setAutoBusy(busyKey);
    setError("");
    setMessage("");
    const previous = templates;
    setTemplates((current) =>
      current.map((item) =>
        item.id === template.id ? { ...item, [field]: value } : item,
      ),
    );
    try {
      const updated = await updateZaloMessageTemplate(template.id, {
        name: template.name,
        description: template.description || "",
        status: template.status,
        auto_send_new_guest:
          field === "auto_send_new_guest" ? value : template.auto_send_new_guest,
        auto_send_checkin:
          field === "auto_send_checkin" ? value : template.auto_send_checkin,
        blocks: template.blocks,
      });
      setTemplates((current) =>
        current.map((item) => (item.id === template.id ? updated : item)),
      );
      setMessage(
        field === "auto_send_new_guest"
          ? value
            ? "Đã bật tự gửi khi guest mới."
            : "Đã tắt tự gửi khi guest mới."
          : value
            ? "Đã bật tự gửi khi check-in."
            : "Đã tắt tự gửi khi check-in.",
      );
    } catch (autoError) {
      setTemplates(previous);
      setError("Không thể cập nhật auto-send: " + errorMessage(autoError));
    } finally {
      setAutoBusy("");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
      <div className="mb-5 flex shrink-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-accent">
            Zalo cá nhân
          </p>
          <h2 className="font-heading mt-1 text-xl font-bold text-ink sm:text-2xl">
            Tin nhắn Zalo
          </h2>
          <p className="mt-1 text-sm text-muted">
            Tạo mẫu nhiều nội dung và gửi có kiểm soát đến khách tham dự.
          </p>
        </div>
        {(canCreate || canBulkSend) && (
          <div className="flex flex-wrap gap-2">
            {canBulkSend && (
              <button
                type="button"
                onClick={() => setBulkOpen(true)}
                disabled={
                  !templates.some((template) => template.status === "active")
                }
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-brand px-4 text-sm font-semibold text-brand transition hover:bg-brand/5 disabled:opacity-40"
              >
                <PaperAirplaneIcon className="h-4 w-4" aria-hidden />
                Gửi hàng loạt
              </button>
            )}
            {canCreate && (
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="inline-flex min-h-10 items-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-brand-teal transition hover:bg-brand-accent"
              >
                <PlusIcon className="h-4 w-4" aria-hidden />
                Tạo mẫu tin
              </button>
            )}
          </div>
        )}
      </div>

      {message && (
        <div
          role="status"
          className="mb-4 flex shrink-0 items-center justify-between rounded-md border border-success-border bg-success-soft px-4 py-3 text-sm text-success"
        >
          <span>{message}</span>
          <button
            type="button"
            onClick={() => setMessage("")}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/50"
            aria-label="Đóng thông báo"
          >
            <XMarkIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="mb-4 flex shrink-0 items-center justify-between rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-error"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError("")}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/50"
            aria-label="Đóng lỗi"
          >
            <XMarkIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      <QuotaCard quota={quota} />

      <section className="overflow-hidden rounded-lg border border-line bg-white shadow-sm lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <div className="shrink-0 border-b border-line px-4 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-heading font-bold text-ink">
                Danh sách mẫu tin
              </h3>
              <p className="mt-0.5 text-xs text-muted">
                {total} mẫu tin trong hệ thống
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setPage(1);
                  setSearch(searchInput);
                }}
                className="flex"
              >
                <div className="relative min-w-0 flex-1 sm:w-60">
                  <MagnifyingGlassIcon
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                    aria-hidden
                  />
                  <input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="Tìm theo tên mẫu tin"
                    className="min-h-10 w-full rounded-l-md border border-line py-2 pl-9 pr-9 text-sm outline-none focus:border-brand"
                  />
                  {!!searchInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchInput("");
                        setSearch("");
                        setPage(1);
                      }}
                      className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted hover:bg-surface-muted"
                      aria-label="Xóa tìm kiếm"
                    >
                      <XMarkIcon className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  className="rounded-r-md border border-l-0 border-line px-3 text-sm font-semibold text-brand-teal transition hover:bg-brand/5"
                >
                  Tìm
                </button>
              </form>
              <select
                value={status}
                onChange={(event) => {
                  setPage(1);
                  setStatus(
                    event.target.value as ZaloMessageTemplateStatus | "",
                  );
                }}
                className="min-h-10 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-brand"
                aria-label="Lọc theo trạng thái"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="admin-table-scroll lg:min-h-0 lg:max-h-none lg:flex-1">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-surface-muted text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-3">Tên mẫu tin</th>
                <th className="px-4 py-3">Nội dung</th>
                <th className="px-4 py-3 text-center">Trạng thái</th>
                <th className="px-4 py-3">Đăng ký</th>
                <th className="px-4 py-3">Check-in</th>
                <th className="px-4 py-3">Cập nhật</th>
                <th className="px-4 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading
                ? [1, 2, 3, 4].map((row) => (
                    <tr key={row}>
                      {[1, 2, 3, 4, 5, 6, 7].map((cell) => (
                        <td key={cell} className="px-4 py-4">
                          <div className="h-4 animate-pulse rounded bg-surface-muted" />
                        </td>
                      ))}
                    </tr>
                  ))
                : templates.map((template) => {
                    const statusMeta =
                      STATUS_META[template.status] || STATUS_META.draft;
                    const counts = template.blocks.reduce<
                      Record<string, number>
                    >(
                      (result, block) => ({
                        ...result,
                        [block.type]: (result[block.type] || 0) + 1,
                      }),
                      {},
                    );
                    return (
                      <tr key={template.id} className="hover:bg-brand/5">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-ink">
                            {template.name}
                          </div>
                          <div className="mt-0.5 max-w-xs truncate text-xs text-muted">
                            {template.description || template.id}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-text-secondary">
                          {template.blocks.length} block · {counts.text || 0}{" "}
                          text · {counts.image || 0} ảnh · {counts.video || 0}{" "}
                          video
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusMeta.className}`}
                          >
                            {statusMeta.label}
                          </span>
                          {template.status !== "active" &&
                            (template.auto_send_new_guest ||
                              template.auto_send_checkin) && (
                              <div className="mt-1 text-[11px] text-amber-700">
                                Chỉ gửi khi mẫu active
                              </div>
                            )}
                        </td>
                        <td className="px-4 py-3">
                          <label
                            className={`inline-flex items-center gap-2 ${canEdit ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                          >
                            <input
                              type="checkbox"
                              className="peer sr-only"
                              checked={template.auto_send_new_guest}
                              disabled={
                                !canEdit ||
                                autoBusy ===
                                  `${template.id}:auto_send_new_guest`
                              }
                              onChange={(event) =>
                                void toggleAutoSend(
                                  template,
                                  "auto_send_new_guest",
                                  event.target.checked,
                                )
                              }
                              aria-label={`Tự gửi khi guest mới — ${template.name}`}
                            />
                            <span
                              className={`relative h-5 w-9 shrink-0 rounded-full transition ${template.auto_send_new_guest ? "bg-brand" : "bg-[#cbd9db]"}`}
                              aria-hidden
                            >
                              <span
                                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${template.auto_send_new_guest ? "left-[18px]" : "left-0.5"}`}
                              />
                            </span>
                            <span className="text-xs text-text-secondary">
                              Tự gửi
                            </span>
                          </label>
                        </td>
                        <td className="px-4 py-3">
                          <label
                            className={`inline-flex items-center gap-2 ${canEdit ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                          >
                            <input
                              type="checkbox"
                              className="peer sr-only"
                              checked={template.auto_send_checkin}
                              disabled={
                                !canEdit ||
                                autoBusy === `${template.id}:auto_send_checkin`
                              }
                              onChange={(event) =>
                                void toggleAutoSend(
                                  template,
                                  "auto_send_checkin",
                                  event.target.checked,
                                )
                              }
                              aria-label={`Tự gửi khi check-in — ${template.name}`}
                            />
                            <span
                              className={`relative h-5 w-9 shrink-0 rounded-full transition ${template.auto_send_checkin ? "bg-brand" : "bg-[#cbd9db]"}`}
                              aria-hidden
                            >
                              <span
                                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${template.auto_send_checkin ? "left-[18px]" : "left-0.5"}`}
                              />
                            </span>
                            <span className="text-xs text-text-secondary">
                              Tự gửi
                            </span>
                          </label>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted">
                          {formatDateTime(template.updated_at)}
                        </td>
                        <td className="px-4 py-3">
                          <TemplateRowActions
                            template={template}
                            canEdit={canEdit}
                            canCreate={canCreate}
                            canDelete={canDelete}
                            canReadDeliveries={canReadDeliveries}
                            onEdit={() => setEditing(template)}
                            onHistory={() => setHistoryTemplate(template)}
                            onClone={() => void clone(template)}
                            onToggle={() => void toggle(template)}
                            onRemove={() => void remove(template)}
                          />
                        </td>
                      </tr>
                    );
                  })}
              {!loading && !templates.length && (
                <tr>
                  <td colSpan={7}>
                    <EmptyTemplatesState
                      canCreate={canCreate}
                      onCreate={() => setEditing(null)}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="admin-table-pagination flex shrink-0 items-center justify-between border-t border-line px-4 py-3 text-sm">
          <span className="text-muted">Tổng cộng {total} mẫu tin</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((value) => value - 1)}
              className="min-h-9 rounded border border-line px-3 transition hover:bg-surface-muted disabled:opacity-40"
            >
              Trang trước
            </button>
            <span className="text-muted">
              Trang {page}/{totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((value) => value + 1)}
              className="min-h-9 rounded border border-line px-3 transition hover:bg-surface-muted disabled:opacity-40"
            >
              Trang sau
            </button>
          </div>
        </div>
      </section>

      {editing !== undefined && (
        <TemplateEditor
          template={editing}
          saving={saving}
          readOnly={editing ? !canEdit : !canCreate}
          onClose={() => setEditing(undefined)}
          onSave={(input) => void save(input)}
        />
      )}
      {bulkOpen && (
        <BulkSendModal
          templates={templates}
          onClose={() => setBulkOpen(false)}
          onSent={() => void load()}
        />
      )}
      {historyTemplate && (
        <TemplateDeliveryHistory
          template={historyTemplate}
          canSend={canSend}
          onClose={() => setHistoryTemplate(null)}
        />
      )}
    </div>
  );
}
