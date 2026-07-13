"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createWorkshop,
  deleteWorkshop,
  deleteWorkshopMedia,
  hardDeleteWorkshop,
  getWorkshop,
  getWorkshopBranches,
  getWorkshops,
  updateWorkshop,
  updateWorkshopStatus,
  uploadWorkshopMedia,
  type WorkshopAdmin,
  type WorkshopMedia,
  type WorkshopStatus,
  type WorkshopWriteBody,
} from "@/lib/api";
import ColumnVisibilityMenu from "@/components/ColumnVisibilityMenu";

type ColumnKey = "name" | "date" | "branch" | "location" | "status" | "form" | "media" | "actions";
const TABLE_COLUMNS = [
  { key: "name", label: "Tên" }, { key: "date", label: "Ngày giờ" }, { key: "branch", label: "Chi nhánh" },
  { key: "location", label: "Địa điểm" }, { key: "status", label: "Trạng thái" },
  { key: "form", label: "Form đăng ký" }, { key: "media", label: "Media" }, { key: "actions", label: "Thao tác" },
] as const;

const STATUS_OPTIONS: { value: WorkshopStatus; label: string }[] = [
  { value: "draft", label: "Nháp" },
  { value: "published", label: "Đã xuất bản" },
  { value: "completed", label: "Hoàn thành" },
  { value: "cancelled", label: "Đã hủy" },
];

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  published: "bg-emerald-100 text-emerald-800",
  completed: "bg-blue-100 text-blue-800",
  cancelled: "bg-red-100 text-red-700",
};

function statusLabel(s?: string | null): string {
  return STATUS_OPTIONS.find((o) => o.value === s)?.label || s || "—";
}

function normalizeTime(t?: string | null): string {
  if (!t) return "00:00";
  // API có thể trả "14:30:00" hoặc "14:30"
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "00:00";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function formatDate(eventDate?: string | null, eventTime?: string | null): string {
  if (!eventDate) return "—";
  const d = new Date(eventDate.length === 10 ? eventDate + "T00:00:00" : eventDate);
  if (Number.isNaN(d.getTime())) return eventDate;
  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  if (!eventTime) return datePart;
  return `${datePart} ${normalizeTime(eventTime)}`;
}

function formPublicUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/register/${token}`;
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workshop";
}

function emptyForm(): WorkshopWriteBody {
  return {
    name: "",
    slug: "",
    event_date: "",
    event_time: "",
    location: "",
    status: "draft",
    branch: "",
    maps_url: "",
    registration_short_url: "",
    lark_workshop_name: "",
  };
}

function formFromWorkshop(w: WorkshopAdmin): WorkshopWriteBody {
  return {
    name: w.name || "",
    slug: w.slug || "",
    event_date: w.event_date || "",
    event_time: w.event_time ? normalizeTime(w.event_time) : "",
    location: w.location || "",
    status: w.status || "draft",
    branch: w.branch || "",
    maps_url: w.maps_url || "",
    registration_short_url: w.registration_short_url || "",
    lark_workshop_name: w.lark_workshop_name || "",
  };
}

function cleanBody(form: WorkshopWriteBody): WorkshopWriteBody {
  return {
    name: form.name.trim(),
    slug: form.slug.trim(),
    event_date: form.event_date || null,
    event_time: form.event_time || null,
    location: form.location?.trim() || null,
    status: form.status || "draft",
    branch: form.branch?.trim() || null,
    maps_url: form.maps_url?.trim() || null,
    registration_short_url: form.registration_short_url?.trim() || null,
    lark_workshop_name: form.lark_workshop_name?.trim() || null,
  };
}

export default function AdminWorkshopPage() {
  const [items, setItems] = useState<WorkshopAdmin[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<WorkshopWriteBody>(emptyForm());
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<WorkshopAdmin | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{
    items: WorkshopMedia[];
    index: number;
    workshopName: string;
  } | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>(() =>
    Object.fromEntries(TABLE_COLUMNS.map(({ key }) => [key, true])) as Record<ColumnKey, boolean>);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ws, br] = await Promise.all([
        getWorkshops(statusFilter || undefined),
        getWorkshopBranches(),
      ]);
      setItems(ws);
      setBranches(br);
    } catch (e: any) {
      setMsg("Lỗi tải workshop: " + (e?.message || "không rõ"));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const all = items.length;
    const by: Record<string, number> = {};
    for (const w of items) by[w.status || "draft"] = (by[w.status || "draft"] || 0) + 1;
    return { all, by };
  }, [items]);

  const openCreate = () => {
    setEditingId(null);
    setDetail(null);
    setForm(emptyForm());
    setSlugTouched(false);
    setModalOpen(true);
  };

  const openEdit = async (w: WorkshopAdmin) => {
    setEditingId(w.id);
    setForm(formFromWorkshop(w));
    setSlugTouched(true);
    setModalOpen(true);
    setDetail(w);
    try {
      const full = await getWorkshop(w.id);
      setDetail(full);
      setForm(formFromWorkshop(full));
    } catch (e: any) {
      setMsg("Lỗi tải chi tiết: " + (e?.message || "không rõ"));
    }
  };

  const closeModal = () => {
    if (saving || uploading) return;
    setModalOpen(false);
    setEditingId(null);
    setDetail(null);
    setForm(emptyForm());
  };

  const setField = <K extends keyof WorkshopWriteBody>(key: K, value: WorkshopWriteBody[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "name" && !slugTouched && !editingId) {
        next.slug = slugify(String(value || ""));
      }
      return next;
    });
  };

  const save = async () => {
    const body = cleanBody(form);
    if (!body.name || !body.slug) {
      setMsg("Vui lòng nhập tên và slug");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await updateWorkshop(editingId, body);
        setMsg("Đã cập nhật workshop");
      } else {
        await createWorkshop(body);
        setMsg("Đã tạo workshop");
      }
      await load();
      setModalOpen(false);
      setEditingId(null);
      setDetail(null);
      setForm(emptyForm());
    } catch (e: any) {
      setMsg("Lỗi lưu: " + (e?.message || "không rõ"));
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (w: WorkshopAdmin, status: WorkshopStatus) => {
    setBusyId(w.id);
    try {
      const next = await updateWorkshopStatus(w.id, status);
      setItems((prev) => prev.map((x) => (x.id === w.id ? { ...x, ...next } : x)));
      if (detail?.id === w.id) setDetail(next);
      setMsg(`Đã đổi trạng thái → ${statusLabel(status)}`);
    } catch (e: any) {
      setMsg("Lỗi đổi status: " + (e?.message || "không rõ"));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (w: WorkshopAdmin) => {
    if (w.status === "cancelled") return;
    if (!confirm(`Hủy workshop "${w.name}"? Workshop sẽ chuyển sang trạng thái Đã hủy (soft-delete).`)) return;
    setBusyId(w.id);
    try {
      const next = await deleteWorkshop(w.id);
      setItems((prev) => prev.map((x) => (x.id === w.id ? { ...x, ...next } : x)));
      if (detail?.id === w.id) setDetail(next);
      setMsg("Đã hủy workshop");
    } catch (e: any) {
      setMsg("Lỗi hủy workshop: " + (e?.message || "không rõ"));
    } finally {
      setBusyId(null);
    }
  };

  const purge = async (w: WorkshopAdmin) => {
    if (
      !confirm(
        `XÓA HẲN workshop "${w.name}"?\nKhách mời, media và liên kết form sẽ bị xóa vĩnh viễn. Không hoàn tác được.`,
      )
    ) {
      return;
    }
    setBusyId(w.id);
    try {
      await hardDeleteWorkshop(w.id);
      setItems((prev) => prev.filter((x) => x.id !== w.id));
      if (editingId === w.id) {
        setModalOpen(false);
        setEditingId(null);
        setDetail(null);
      }
      setMsg("Đã xóa hẳn workshop");
    } catch (e: any) {
      setMsg("Lỗi xóa hẳn: " + (e?.message || "không rõ"));
    } finally {
      setBusyId(null);
    }
  };

  const onUpload = async (files: FileList | null) => {
    if (!editingId || !files?.length) return;
    setUploading(true);
    try {
      const list = await uploadWorkshopMedia(editingId, Array.from(files));
      setDetail((prev) =>
        prev
          ? { ...prev, media: [...(prev.media || []), ...list] }
          : prev,
      );
      setMsg(`Đã upload ${list.length} file`);
    } catch (e: any) {
      setMsg("Lỗi upload: " + (e?.message || "không rõ"));
    } finally {
      setUploading(false);
    }
  };

  const removeMedia = async (m: WorkshopMedia) => {
    if (!editingId) return;
    if (!confirm(`Xóa file "${m.file_name || m.file_url}"?`)) return;
    try {
      await deleteWorkshopMedia(editingId, m.id);
      setDetail((prev) =>
        prev ? { ...prev, media: (prev.media || []).filter((x) => x.id !== m.id) } : prev,
      );
      setMsg("Đã xóa media");
    } catch (e: any) {
      setMsg("Lỗi xóa media: " + (e?.message || "không rõ"));
    }
  };

  const isImage = (m: WorkshopMedia) =>
    (m.mime_type || "").startsWith("image/") ||
    /\.(jpe?g|png|webp|heic|heif)$/i.test(m.file_url || "");

  const openPreview = (items: WorkshopMedia[], index: number, workshopName: string) => {
    if (!items.length) return;
    setPreview({ items, index, workshopName });
  };

  const previewItem = preview ? preview.items[preview.index] : null;

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-brand-teal">Workshop</h1>
            <p className="text-sm text-muted mt-1">
              Quản lý workshop: thông tin, chi nhánh, media, link đăng ký và trạng thái.
            </p>
          </div>
          <button
            onClick={openCreate}
            className="bg-brand text-white px-4 py-2 rounded-sm text-sm font-medium whitespace-nowrap"
          >
            + Tạo Workshop
          </button>
        </div>

        {msg && (
          <div className="mb-3 p-2 bg-brand/10 text-brand-teal rounded-sm text-sm flex items-center justify-between">
            <span>{msg}</span>
            <button onClick={() => setMsg("")} className="text-muted text-lg leading-none">
              ×
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setStatusFilter("")}
            className={`px-3 py-1.5 rounded-sm text-sm border ${
              !statusFilter ? "bg-brand text-white border-brand" : "border-line text-muted"
            }`}
          >
            Tất cả ({statusFilter ? "…" : counts.all})
          </button>
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setStatusFilter(o.value)}
              className={`px-3 py-1.5 rounded-sm text-sm border ${
                statusFilter === o.value
                  ? "bg-brand text-white border-brand"
                  : "border-line text-muted"
              }`}
            >
              {o.label}
              {!statusFilter && counts.by[o.value] ? ` (${counts.by[o.value]})` : ""}
            </button>
          ))}
        </div>
        <div className="mb-3 flex justify-end">
          <ColumnVisibilityMenu columns={TABLE_COLUMNS} visible={visibleColumns} onChange={setVisibleColumns} />
        </div>

        {loading ? (
          <div className="text-sm text-muted py-12 text-center">Đang tải…</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-muted py-12 text-center border border-dashed border-line rounded-md">
            Chưa có workshop nào.
          </div>
        ) : (
          <div className="admin-table-scroll border border-line rounded-md bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-muted">
                <tr>
                  {visibleColumns.name && <th className="px-3 py-2 font-medium">Tên</th>}
                  {visibleColumns.date && <th className="px-3 py-2 font-medium">Ngày giờ</th>}
                  {visibleColumns.branch && <th className="px-3 py-2 font-medium">Chi nhánh</th>}
                  {visibleColumns.location && <th className="px-3 py-2 font-medium">Địa điểm</th>}
                  {visibleColumns.status && <th className="px-3 py-2 font-medium">Trạng thái</th>}
                  {visibleColumns.form && <th className="px-3 py-2 font-medium">Form đăng ký</th>}
                  {visibleColumns.media && <th className="px-3 py-2 font-medium">Media</th>}
                  {visibleColumns.actions && <th className="px-3 py-2 font-medium text-right">Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((w) => (
                  <tr key={w.id} className="border-t border-line align-top">
                    {visibleColumns.name && <td className="px-3 py-2">
                      <div className="font-medium text-brand-teal">{w.name}</div>
                      <div className="text-xs text-muted">{w.slug}</div>
                    </td>}
                    {visibleColumns.date && <td className="px-3 py-2 whitespace-nowrap">{formatDate(w.event_date, w.event_time)}</td>}
                    {visibleColumns.branch && <td className="px-3 py-2">{w.branch || "—"}</td>}
                    {visibleColumns.location && <td className="px-3 py-2 max-w-[180px]">
                      <div className="line-clamp-2">{w.location || "—"}</div>
                      {w.maps_url && (
                        <a
                          href={w.maps_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-brand underline"
                        >
                          Maps
                        </a>
                      )}
                    </td>}
                    {visibleColumns.status && <td className="px-3 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          STATUS_CLASS[w.status] || STATUS_CLASS.draft
                        }`}
                      >
                        {statusLabel(w.status)}
                      </span>
                    </td>}
                    {visibleColumns.form && <td className="px-3 py-2 max-w-[280px]">
                      {(w.registration_forms || []).length === 0 ? (
                        <span className="text-xs text-muted">—</span>
                      ) : (
                        <span className="text-xs break-all">
                          {(w.registration_forms || []).map((f, i) => {
                            const url = formPublicUrl(f.token);
                            return (
                              <span key={f.id}>
                                {i > 0 && ", "}
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-brand underline"
                                  title={url}
                                >
                                  {url}
                                </a>
                              </span>
                            );
                          })}
                        </span>
                      )}
                    </td>}
                    {visibleColumns.media && <td className="px-3 py-2">
                      {(w.media || []).length === 0 ? (
                        <span className="text-xs text-muted">—</span>
                      ) : (
                        <div className="flex items-center gap-1 flex-wrap max-w-[140px]">
                          {(w.media || []).slice(0, 4).map((m, idx) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => openPreview(w.media || [], idx, w.name)}
                              className="w-10 h-10 rounded border border-line overflow-hidden bg-surface-muted shrink-0 hover:ring-2 hover:ring-brand/40"
                              title={m.file_name || "Xem media"}
                            >
                              {isImage(m) ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={m.file_url}
                                  alt={m.file_name || ""}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="w-full h-full flex items-center justify-center text-[9px] text-muted font-medium">
                                  DOC
                                </span>
                              )}
                            </button>
                          ))}
                          {(w.media || []).length > 4 && (
                            <button
                              type="button"
                              onClick={() => openPreview(w.media || [], 4, w.name)}
                              className="w-10 h-10 rounded border border-line bg-surface-muted text-[10px] text-muted font-medium hover:bg-brand/10"
                            >
                              +{(w.media || []).length - 4}
                            </button>
                          )}
                        </div>
                      )}
                    </td>}
                    {visibleColumns.actions && <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        <button
                          onClick={() => openEdit(w)}
                          className="px-2 py-1 border border-line rounded-sm text-xs hover:bg-surface-muted"
                        >
                          Sửa
                        </button>
                        {w.status !== "published" && (
                          <button
                            disabled={busyId === w.id}
                            onClick={() => changeStatus(w, "published")}
                            className="px-2 py-1 border border-emerald-300 text-emerald-700 rounded-sm text-xs"
                          >
                            Publish
                          </button>
                        )}
                        {w.status === "published" && (
                          <button
                            disabled={busyId === w.id}
                            onClick={() => changeStatus(w, "completed")}
                            className="px-2 py-1 border border-blue-300 text-blue-700 rounded-sm text-xs"
                          >
                            Hoàn thành
                          </button>
                        )}
                        {w.status !== "cancelled" && (
                          <button
                            disabled={busyId === w.id}
                            onClick={() => remove(w)}
                            className="px-2 py-1 border border-red-200 text-red-600 rounded-sm text-xs"
                          >
                            Hủy
                          </button>
                        )}
                        <button
                          disabled={busyId === w.id}
                          onClick={() => purge(w)}
                          className="px-2 py-1 border border-red-500 bg-red-50 text-red-700 rounded-sm text-xs font-medium"
                        >
                          Xóa
                        </button>
                      </div>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
          <div className="bg-surface w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-lg sm:rounded-md shadow-xl border border-line">
            <div className="sticky top-0 bg-surface border-b border-line px-4 py-3 flex items-center justify-between">
              <h2 className="font-bold text-brand-teal">
                {editingId ? "Sửa Workshop" : "Tạo Workshop"}
              </h2>
              <button onClick={closeModal} className="text-muted text-xl leading-none px-2">
                ×
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block sm:col-span-2">
                  <span className="text-xs text-muted">Tên workshop *</span>
                  <input
                    className="mt-1 w-full border border-line rounded-sm px-3 py-2 text-sm"
                    value={form.name}
                    onChange={(e) => setField("name", e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted">Slug *</span>
                  <input
                    className="mt-1 w-full border border-line rounded-sm px-3 py-2 text-sm font-mono"
                    value={form.slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setField("slug", e.target.value);
                    }}
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted">Chi nhánh</span>
                  <select
                    className="mt-1 w-full border border-line rounded-sm px-3 py-2 text-sm"
                    value={form.branch || ""}
                    onChange={(e) => setField("branch", e.target.value)}
                  >
                    <option value="">— Chọn —</option>
                    {branches.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-muted">Ngày sự kiện</span>
                  <input
                    type="date"
                    className="mt-1 w-full border border-line rounded-sm px-3 py-2 text-sm"
                    value={form.event_date || ""}
                    onChange={(e) => setField("event_date", e.target.value || "")}
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted">Thời gian (hh:mm)</span>
                  <input
                    type="time"
                    className="mt-1 w-full border border-line rounded-sm px-3 py-2 text-sm"
                    value={form.event_time || ""}
                    onChange={(e) => setField("event_time", e.target.value || "")}
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted">Trạng thái</span>
                  <select
                    className="mt-1 w-full border border-line rounded-sm px-3 py-2 text-sm"
                    value={form.status || "draft"}
                    onChange={(e) => setField("status", e.target.value)}
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs text-muted">Địa điểm</span>
                  <input
                    className="mt-1 w-full border border-line rounded-sm px-3 py-2 text-sm"
                    value={form.location || ""}
                    onChange={(e) => setField("location", e.target.value)}
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs text-muted">Google Maps URL</span>
                  <input
                    className="mt-1 w-full border border-line rounded-sm px-3 py-2 text-sm"
                    placeholder="https://maps.google.com/..."
                    value={form.maps_url || ""}
                    onChange={(e) => setField("maps_url", e.target.value)}
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs text-muted">Tên trên Lark (giữ tương thích sync)</span>
                  <input
                    className="mt-1 w-full border border-line rounded-sm px-3 py-2 text-sm"
                    value={form.lark_workshop_name || ""}
                    onChange={(e) => setField("lark_workshop_name", e.target.value)}
                  />
                </label>
              </div>

              {editingId && detail && (
                <div className="border-t border-line pt-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="text-sm font-semibold text-brand-teal">Media</h3>
                    <label className="cursor-pointer bg-brand/10 text-brand px-3 py-1.5 rounded-sm text-xs font-medium">
                      {uploading ? "Đang upload…" : "+ Upload"}
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        disabled={uploading}
                        accept="image/*,.pdf,.doc,.docx"
                        onChange={(e) => {
                          onUpload(e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                  {(detail.media || []).length === 0 ? (
                    <p className="text-xs text-muted">Chưa có file.</p>
                  ) : (
                    <ul className="space-y-2">
                      {(detail.media || []).map((m) => (
                        <li
                          key={m.id}
                          className="flex items-center gap-3 border border-line rounded-sm p-2"
                        >
                          {isImage(m) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={m.file_url}
                              alt={m.file_name || ""}
                              className="w-14 h-14 object-cover rounded bg-surface-muted"
                            />
                          ) : (
                            <div className="w-14 h-14 flex items-center justify-center bg-surface-muted rounded text-xs text-muted">
                              DOC
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium truncate">
                              {m.file_name || m.file_url}
                            </div>
                            {m.file_size != null && (
                              <div className="text-[11px] text-muted">
                                {(m.file_size / 1024).toFixed(0)} KB
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => removeMedia(m)}
                            className="text-xs text-red-600 px-2 py-1"
                          >
                            Xóa
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-surface border-t border-line px-4 py-3 flex justify-end gap-2">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm border border-line rounded-sm"
                disabled={saving}
              >
                Đóng
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 text-sm bg-brand text-white rounded-sm font-medium disabled:opacity-50"
              >
                {saving ? "Đang lưu…" : editingId ? "Lưu thay đổi" : "Tạo workshop"}
              </button>
            </div>
          </div>
        </div>
      )}

      {preview && previewItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="relative bg-surface rounded-md shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-brand-teal truncate">
                  {preview.workshopName}
                </div>
                <div className="text-xs text-muted truncate">
                  {previewItem.file_name || previewItem.file_url}
                  {preview.items.length > 1
                    ? ` · ${preview.index + 1}/${preview.items.length}`
                    : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="text-muted text-xl leading-none px-2 shrink-0"
                aria-label="Đóng preview"
              >
                ×
              </button>
            </div>
            <div className="flex-1 min-h-0 flex items-center justify-center p-4 bg-black/5 overflow-auto">
              {isImage(previewItem) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewItem.file_url}
                  alt={previewItem.file_name || ""}
                  className="max-w-full max-h-[70vh] object-contain rounded"
                />
              ) : (
                <div className="text-center space-y-3 py-10">
                  <div className="text-sm text-muted">Không phải ảnh — mở file gốc:</div>
                  <a
                    href={previewItem.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block px-4 py-2 bg-brand text-white text-sm rounded-sm"
                  >
                    Mở file
                  </a>
                </div>
              )}
            </div>
            {preview.items.length > 1 && (
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-line">
                <button
                  type="button"
                  className="px-3 py-1.5 text-sm border border-line rounded-sm disabled:opacity-40"
                  disabled={preview.index <= 0}
                  onClick={() =>
                    setPreview((p) => (p ? { ...p, index: Math.max(0, p.index - 1) } : p))
                  }
                >
                  ← Trước
                </button>
                <div className="flex gap-1 overflow-x-auto max-w-[60%]">
                  {preview.items.map((m, i) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPreview((p) => (p ? { ...p, index: i } : p))}
                      className={`w-10 h-10 rounded border overflow-hidden shrink-0 ${
                        i === preview.index ? "ring-2 ring-brand border-brand" : "border-line"
                      }`}
                    >
                      {isImage(m) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.file_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="w-full h-full flex items-center justify-center text-[9px] text-muted">
                          DOC
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="px-3 py-1.5 text-sm border border-line rounded-sm disabled:opacity-40"
                  disabled={preview.index >= preview.items.length - 1}
                  onClick={() =>
                    setPreview((p) =>
                      p ? { ...p, index: Math.min(p.items.length - 1, p.index + 1) } : p,
                    )
                  }
                >
                  Sau →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
