"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  pushWorkshopToLark,
  type WorkshopAdmin,
  type WorkshopMedia,
  type WorkshopStatus,
  type WorkshopWriteBody,
} from "@/lib/api";
import ColumnVisibilityMenu from "@/components/ColumnVisibilityMenu";
import Can from "@/components/Can";
import { useAuth } from "@/contexts/AuthContext";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { PERMISSIONS } from "@/lib/permissions";

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

const NEXT_STATUS: Partial<Record<WorkshopStatus, WorkshopStatus>> = {
  draft: "published",
  published: "completed",
  cancelled: "draft",
};

type WorkshopSort = "event_desc" | "event_asc" | "name_asc" | "updated_desc";

function searchable(value?: string | null): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

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
    auto_confirm_registration: true,
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
    auto_confirm_registration: w.auto_confirm_registration ?? true,
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
    auto_confirm_registration: form.auto_confirm_registration,
    branch: form.branch?.trim() || null,
    maps_url: form.maps_url?.trim() || null,
    registration_short_url: form.registration_short_url?.trim() || null,
    lark_workshop_name: form.lark_workshop_name?.trim() || null,
  };
}

export default function AdminWorkshopPage() {
  const { can } = useAuth();
  const [items, setItems] = useState<WorkshopAdmin[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<WorkshopSort>("event_desc");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [mobileLimit, setMobileLimit] = useState(10);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<WorkshopWriteBody>(emptyForm());
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [detail, setDetail] = useState<WorkshopAdmin | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{
    items: WorkshopMedia[];
    index: number;
    workshopName: string;
  } | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>(() =>
    Object.fromEntries(TABLE_COLUMNS.map(({ key }) => [key, true])) as Record<ColumnKey, boolean>);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useDialogFocus(modalOpen, dialogRef, "#workshop-name");
  useDialogFocus(Boolean(preview), previewRef, "[data-preview-close]");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ws, br] = await Promise.all([
        getWorkshops(),
        getWorkshopBranches(),
      ]);
      setItems(ws);
      setBranches(br);
    } catch (e: any) {
      setMsg("Lỗi tải workshop: " + (e?.message || "không rõ"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const all = items.length;
    const by: Record<string, number> = {};
    for (const w of items) by[w.status || "draft"] = (by[w.status || "draft"] || 0) + 1;
    return { all, by };
  }, [items]);

  const filteredItems = useMemo(() => {
    const query = searchable(search.trim());
    const result = items.filter((w) => {
      if (statusFilter && w.status !== statusFilter) return false;
      if (!query) return true;
      return searchable([w.name, w.slug, w.branch, w.location].filter(Boolean).join(" ")).includes(query);
    });
    return result.sort((a, b) => {
      if (sort === "name_asc") return a.name.localeCompare(b.name, "vi");
      if (sort === "updated_desc") return String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at));
      const aDate = `${a.event_date || "0000-00-00"}T${normalizeTime(a.event_time)}`;
      const bDate = `${b.event_date || "0000-00-00"}T${normalizeTime(b.event_time)}`;
      return sort === "event_asc" ? aDate.localeCompare(bDate) : bDate.localeCompare(aDate);
    });
  }, [items, search, sort, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const page = Math.min(currentPage, pageCount);
  const desktopItems = useMemo(
    () => filteredItems.slice((page - 1) * pageSize, page * pageSize),
    [filteredItems, page, pageSize],
  );
  const mobileItems = useMemo(() => filteredItems.slice(0, mobileLimit), [filteredItems, mobileLimit]);
  const firstRow = filteredItems.length ? (page - 1) * pageSize + 1 : 0;
  const lastRow = Math.min(page * pageSize, filteredItems.length);

  useEffect(() => {
    setCurrentPage(1);
    setMobileLimit(10);
  }, [search, sort, statusFilter, pageSize]);

  useEffect(() => {
    if (currentPage > pageCount) setCurrentPage(pageCount);
  }, [currentPage, pageCount]);

  useEffect(() => {
    if (!modalOpen && !preview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (preview) setPreview(null);
      else if (!saving && !uploading) closeModal();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const openCreate = () => {
    setEditingId(null);
    setDetail(null);
    setForm(emptyForm());
    setFormError("");
    setSlugTouched(false);
    setModalOpen(true);
  };

  const openEdit = async (w: WorkshopAdmin) => {
    setEditingId(w.id);
    setFormError("");
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
    setFormError("");
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
      setFormError("Vui lòng nhập tên và slug.");
      return;
    }
    setFormError("");
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
      setFormError("Không thể lưu workshop: " + (e?.message || "không rõ"));
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

  const pushLark = async (w: WorkshopAdmin) => {
    setBusyId(w.id);
    try {
      const res = await pushWorkshopToLark(w.id);
      setItems((prev) =>
        prev.map((x) => (x.id === w.id ? { ...x, lark_record_id: res.lark_record_id } : x)),
      );
      setMsg(`Đã đẩy "${w.name}" lên Lark`);
    } catch (e: any) {
      setMsg("Lỗi đẩy lên Lark: " + (e?.message || "không rõ"));
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
    <div className="px-3 py-3 pb-20 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div>
            <h1 className="text-2xl font-bold text-brand-teal">Workshop</h1>
            <p className="text-sm text-muted mt-1">
              Quản lý workshop: thông tin, chi nhánh, media, link đăng ký và trạng thái.
            </p>
          </div>
          <Can permission={PERMISSIONS.workshopsCreate}>
            <button
              onClick={openCreate}
              className="min-h-11 w-full bg-brand text-brand-teal px-4 py-2 rounded-md text-sm font-semibold whitespace-nowrap sm:w-auto sm:rounded-sm"
            >
              + Tạo Workshop
            </button>
          </Can>
        </div>

        {msg && (
          <div
            role={/^Lỗi|^Không thể|^Vui lòng/.test(msg) ? "alert" : "status"}
            aria-live={/^Lỗi|^Không thể|^Vui lòng/.test(msg) ? "assertive" : "polite"}
            className={`mb-3 flex items-center gap-2 rounded-md border p-2.5 text-sm animate-toast-in ${
              /^Lỗi|^Không thể|^Vui lòng/.test(msg)
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-success-border bg-success-soft text-brand-teal"
            }`}
          >
            <span className="flex-1">{msg}</span>
            <button
              onClick={() => setMsg("")}
              aria-label="Đóng thông báo"
              className="min-h-11 min-w-11 text-muted text-lg leading-none"
            >
              ×
            </button>
          </div>
        )}

        <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(240px,1fr)_190px]">
          <label className="relative block">
            <span className="sr-only">Tìm workshop</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tìm theo tên, slug, chi nhánh, địa điểm..."
              className="min-h-11 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm sm:min-h-0 sm:rounded-sm"
            />
          </label>
          <label>
            <span className="sr-only">Sắp xếp workshop</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as WorkshopSort)}
              className="min-h-11 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm sm:min-h-0 sm:rounded-sm"
            >
              <option value="event_desc">Ngày sự kiện: mới nhất</option>
              <option value="event_asc">Ngày sự kiện: cũ nhất</option>
              <option value="name_asc">Tên: A–Z</option>
              <option value="updated_desc">Cập nhật gần nhất</option>
            </select>
          </label>
        </div>

        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="-mx-3 flex flex-1 gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            <button
              onClick={() => setStatusFilter("")}
              aria-pressed={!statusFilter}
              className={`min-h-11 shrink-0 px-3 py-1.5 rounded-md text-sm border sm:min-h-0 sm:rounded-sm ${
                !statusFilter ? "bg-brand text-brand-teal border-brand" : "border-line text-muted"
              }`}
            >
              Tất cả ({counts.all})
            </button>
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setStatusFilter(o.value)}
                aria-pressed={statusFilter === o.value}
                className={`min-h-11 shrink-0 px-3 py-1.5 rounded-md text-sm border sm:min-h-0 sm:rounded-sm ${
                  statusFilter === o.value
                    ? "bg-brand text-brand-teal border-brand"
                    : "border-line text-muted"
                }`}
              >
                {o.label}
                {` (${counts.by[o.value] || 0})`}
              </button>
            ))}
          </div>
          <div className="hidden md:block">
            <ColumnVisibilityMenu columns={TABLE_COLUMNS} visible={visibleColumns} onChange={setVisibleColumns} />
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted py-12 text-center">Đang tải…</div>
        ) : filteredItems.length === 0 ? (
          <div className="text-sm text-muted py-12 text-center border border-dashed border-line rounded-md">
            {items.length ? "Không có workshop khớp bộ lọc." : "Chưa có workshop nào."}
          </div>
        ) : (
          <>
            <div className="space-y-2.5 md:hidden">
              {mobileItems.map((w) => {
                const registrationForms = w.registration_forms || [];
                const media = w.media || [];
                return (
                  <article key={w.id} className="rounded-md border border-line bg-surface p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h2 className="line-clamp-2 font-heading text-[15px] font-bold leading-5 text-brand-teal">{w.name}</h2>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-muted">{w.slug}</p>
                      </div>
                      <span className={`shrink-0 rounded px-2 py-1 text-[10px] font-semibold ${STATUS_CLASS[w.status] || STATUS_CLASS.draft}`}>
                        {statusLabel(w.status)}
                      </span>
                    </div>

                    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      <div>
                        <dt className="text-muted">Ngày giờ</dt>
                        <dd className="mt-0.5 font-medium text-brand-teal">{formatDate(w.event_date, w.event_time)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">Chi nhánh</dt>
                        <dd className="mt-0.5 font-medium text-brand-teal">{w.branch || "—"}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-muted">Địa điểm</dt>
                        <dd className="mt-0.5 flex items-start gap-2 font-medium text-brand-teal">
                          <span className="min-w-0 flex-1">{w.location || "—"}</span>
                          {w.maps_url && <a href={w.maps_url} target="_blank" rel="noreferrer" className="shrink-0 text-brand underline">Maps</a>}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 text-xs">
                      <div className="min-w-0">
                        <span className="text-muted">Form đăng ký: </span>
                        {registrationForms.length ? (
                          <a href={formPublicUrl(registrationForms[0].token)} target="_blank" rel="noreferrer" className="font-semibold text-brand underline">
                            {registrationForms.length} form
                          </a>
                        ) : <span className="text-brand-teal">Chưa có</span>}
                      </div>
                      {media.length > 0 && (
                        <button type="button" onClick={() => openPreview(media, 0, w.name)} className="min-h-11 shrink-0 rounded-md border border-line px-3 font-semibold text-brand-teal">
                          Media ({media.length})
                        </button>
                      )}
                    </div>

                    {can(PERMISSIONS.workshopsEdit) && (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button onClick={() => openEdit(w)} className="min-h-11 rounded-md border border-line text-sm font-semibold text-brand-teal">Sửa</button>
                        {NEXT_STATUS[w.status as WorkshopStatus] && (
                          <button
                            disabled={busyId === w.id}
                            onClick={() => changeStatus(w, NEXT_STATUS[w.status as WorkshopStatus]!)}
                            className="min-h-11 rounded-md border border-brand bg-brand text-sm font-semibold text-brand-teal disabled:opacity-50"
                          >
                            {w.status === "draft" ? "Xuất bản" : w.status === "published" ? "Hoàn thành" : "Khôi phục về nháp"}
                          </button>
                        )}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2 text-xs">
                      <Can permission="lark.sync">
                        <button disabled={busyId === w.id} onClick={() => pushLark(w)} className="min-h-11 font-semibold text-brand-teal disabled:opacity-50">
                          {w.lark_record_id ? "Cập nhật Lark" : "Đẩy lên Lark"}
                        </button>
                      </Can>
                      {can(PERMISSIONS.workshopsDelete) && (w.status === "draft" || w.status === "published") && <button disabled={busyId === w.id} onClick={() => remove(w)} className="min-h-11 font-semibold text-red-600 disabled:opacity-50">Hủy</button>}
                      {can(PERMISSIONS.workshopsDelete) && w.status === "cancelled" && <button disabled={busyId === w.id} onClick={() => purge(w)} className="min-h-11 font-semibold text-red-700 disabled:opacity-50">Xóa vĩnh viễn</button>}
                    </div>
                  </article>
                );
              })}
              {mobileLimit < filteredItems.length && (
                <button
                  type="button"
                  onClick={() => setMobileLimit((limit) => limit + 10)}
                  className="min-h-11 w-full rounded-md border border-line bg-surface text-sm font-semibold text-brand-teal"
                >
                  Xem thêm ({filteredItems.length - mobileLimit} workshop)
                </button>
              )}
            </div>

            <div className="admin-table-scroll hidden border border-line rounded-md bg-surface md:block">
              <table className="w-full min-w-[1100px] text-sm">
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
                {desktopItems.map((w) => (
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
                        <span className="space-y-1 text-xs">
                          {(w.registration_forms || []).map((f, i) => {
                            const url = formPublicUrl(f.token);
                            return (
                              <span key={f.id} className="block">
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-brand underline"
                                  title={url}
                                >
                                  Mở form {i + 1}
                                </a>
                                <span className="text-muted"> · {f.submission_count} lượt gửi</span>
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
                        {can(PERMISSIONS.workshopsEdit) && <button
                          onClick={() => openEdit(w)}
                          className="px-2 py-1 border border-line rounded-sm text-xs hover:bg-surface-muted"
                        >
                          Sửa
                        </button>}
                        {can(PERMISSIONS.workshopsEdit) && w.status === "draft" && (
                          <button
                            disabled={busyId === w.id}
                            onClick={() => changeStatus(w, "published")}
                            className="px-2 py-1 border border-emerald-300 text-emerald-700 rounded-sm text-xs"
                          >
                            Xuất bản
                          </button>
                        )}
                        {can(PERMISSIONS.workshopsEdit) && w.status === "cancelled" && (
                          <button
                            disabled={busyId === w.id}
                            onClick={() => changeStatus(w, "draft")}
                            className="px-2 py-1 border border-line text-brand-teal rounded-sm text-xs"
                          >
                            Khôi phục về nháp
                          </button>
                        )}
                        {can(PERMISSIONS.workshopsEdit) && w.status === "published" && (
                          <button
                            disabled={busyId === w.id}
                            onClick={() => changeStatus(w, "completed")}
                            className="px-2 py-1 border border-blue-300 text-blue-700 rounded-sm text-xs"
                          >
                            Hoàn thành
                          </button>
                        )}
                        <Can permission="lark.sync">
                          <button
                            disabled={busyId === w.id}
                            onClick={() => pushLark(w)}
                            title={w.lark_record_id ? "Cập nhật lên Lark" : "Đẩy lên Lark"}
                            className="px-2 py-1 border border-line rounded-sm text-xs hover:bg-surface-muted"
                          >
                            {w.lark_record_id ? "Cập nhật Lark" : "Đẩy lên Lark"}
                          </button>
                        </Can>
                        {can(PERMISSIONS.workshopsDelete) && (w.status === "draft" || w.status === "published") && (
                          <button
                            disabled={busyId === w.id}
                            onClick={() => remove(w)}
                            className="px-2 py-1 border border-red-200 text-red-600 rounded-sm text-xs"
                          >
                            Hủy
                          </button>
                        )}
                        {can(PERMISSIONS.workshopsDelete) && w.status === "cancelled" && <button
                          disabled={busyId === w.id}
                          onClick={() => purge(w)}
                          className="px-2 py-1 border border-red-500 bg-red-50 text-red-700 rounded-sm text-xs font-medium"
                        >
                          Xóa vĩnh viễn
                        </button>}
                      </div>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
              <div className="admin-table-pagination flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-3 text-sm">
                <div className="text-muted">Hiển thị {firstRow}–{lastRow} trong tổng số {filteredItems.length} workshop</div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-muted">
                    Dòng/trang
                    <select
                      aria-label="Số workshop mỗi trang"
                      value={pageSize}
                      onChange={(event) => setPageSize(Number(event.target.value))}
                      className="rounded-sm border border-line bg-surface px-2 py-1 text-ink"
                    >
                      {[10, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}
                    </select>
                  </label>
                  <button type="button" disabled={page <= 1} onClick={() => setCurrentPage(page - 1)} className="rounded-sm border border-line px-2 py-1 disabled:opacity-40">Trước</button>
                  <span>Trang {page}/{pageCount}</span>
                  <button type="button" disabled={page >= pageCount} onClick={() => setCurrentPage(page + 1)} className="rounded-sm border border-line px-2 py-1 disabled:opacity-40">Sau</button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="workshop-dialog-title"
            aria-describedby={formError ? "workshop-form-error" : undefined}
            tabIndex={-1}
            className="bg-surface w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-lg sm:rounded-md shadow-xl border border-line pb-[env(safe-area-inset-bottom)] sm:pb-0"
          >
            <div className="sticky top-0 bg-surface border-b border-line px-4 py-3 flex items-center justify-between">
              <h2 id="workshop-dialog-title" className="font-bold text-brand-teal">
                {editingId ? "Sửa Workshop" : "Tạo Workshop"}
              </h2>
              <button onClick={closeModal} aria-label="Đóng" className="min-h-11 min-w-11 text-muted text-xl leading-none px-2">
                ×
              </button>
            </div>

            <div className="p-4 space-y-3">
              {formError && (
                <div id="workshop-form-error" role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {formError}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block sm:col-span-2">
                  <span className="text-xs text-muted">Tên workshop *</span>
                  <input
                    id="workshop-name"
                    required
                    aria-invalid={Boolean(formError && !form.name.trim())}
                    className="mt-1 w-full border border-line rounded-sm px-3 py-2 text-sm"
                    value={form.name}
                    onChange={(e) => setField("name", e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted">Slug *</span>
                  <input
                    required
                    aria-invalid={Boolean(formError && !form.slug.trim())}
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
                <label className="flex cursor-pointer items-start gap-3 rounded-md border border-line bg-surface-muted p-3 sm:col-span-2">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-describedby="auto-confirm-help"
                    className="mt-0.5 h-5 w-5 accent-brand"
                    checked={form.auto_confirm_registration}
                    onChange={(e) => setField("auto_confirm_registration", e.target.checked)}
                  />
                  <span>
                    <span className="block text-sm font-semibold text-brand-teal">Tự động xác nhận đăng ký</span>
                    <span id="auto-confirm-help" className="mt-1 block text-xs leading-5 text-muted">
                      Khi bật, khách được xác nhận và nhận ZNS ngay sau khi đăng ký. Khi tắt, Admin cần xác nhận khách thủ công.
                    </span>
                  </span>
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
                  <div className="mt-1 min-h-10 rounded-sm border border-line bg-surface-muted px-3 py-2 text-sm text-muted">
                    {statusLabel(form.status)}
                  </div>
                  <span className="mt-1 block text-[11px] text-muted">Đổi trạng thái từ danh sách workshop.</span>
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

            <div className="sticky bottom-0 grid grid-cols-2 gap-2 border-t border-line bg-surface px-4 py-3 sm:flex sm:justify-end">
              <button
                onClick={closeModal}
                className="min-h-11 px-4 py-2 text-sm border border-line rounded-md sm:rounded-sm"
                disabled={saving}
              >
                Đóng
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="min-h-11 px-4 py-2 text-sm bg-brand text-brand-teal rounded-md font-semibold disabled:opacity-50 sm:rounded-sm"
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
            ref={previewRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="media-preview-title"
            tabIndex={-1}
            className="relative bg-surface rounded-md shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
              <div className="min-w-0">
                 <div id="media-preview-title" className="text-sm font-semibold text-brand-teal truncate">
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
                 data-preview-close
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
                    className="inline-block px-4 py-2 bg-brand text-brand-teal text-sm font-semibold rounded-sm"
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
