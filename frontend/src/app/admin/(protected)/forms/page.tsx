"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import CreateRegistrationFormModal from "@/components/CreateRegistrationFormModal";
import ColumnVisibilityMenu from "@/components/ColumnVisibilityMenu";
import {
  deleteRegistrationForm,
  listRegistrationForms,
  updateRegistrationForm,
  type RegistrationForm,
} from "@/lib/api";

type ColumnKey = "workshop" | "link" | "qr" | "status" | "submissions" | "created" | "actions";
const TABLE_COLUMNS = [
  { key: "workshop", label: "Workshop" }, { key: "link", label: "Link" },
  { key: "qr", label: "QR" }, { key: "status", label: "Trạng thái" },
  { key: "submissions", label: "Submit" }, { key: "created", label: "Ngày tạo" },
  { key: "actions", label: "Thao tác" },
] as const;

function formatDateTime(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN");
}

function publicUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/register/${token}`;
}

function FormQr({ token, compact = false }: { token: string; compact?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const url = publicUrl(token);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  const downloadQr = () => {
    const svg = wrapRef.current?.querySelector("svg");
    if (!svg) return;
    const size = 120;
    const scale = 4;
    const svgData = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const objUrl = URL.createObjectURL(svgBlob);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size * scale;
      canvas.height = size * scale;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      URL.revokeObjectURL(objUrl);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `form-dang-ky-${token}.png`;
      a.click();
    };
    img.src = objUrl;
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={wrapRef} className={compact ? "fixed -left-[9999px] top-0" : "bg-white p-2 rounded-lg border border-line"} style={compact ? undefined : { width: 136, height: 136 }} aria-hidden={compact}>
        <QRCode value={url} size={120} level="M" style={{ height: "auto", maxWidth: "100%", width: "100%" }} />
      </div>
      {compact ? <button type="button" onClick={() => setOpen(true)} className="min-h-10 rounded-md border border-line px-3 text-xs font-semibold text-brand-teal">Xem QR</button> : <button onClick={downloadQr} className="text-xs text-brand underline min-h-10">Tải QR</button>}
      {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="QR form đăng ký" onClick={() => setOpen(false)}>
        <div className="w-full max-w-sm rounded-lg bg-surface p-5 text-center" onClick={(event) => event.stopPropagation()}>
          <div className="mx-auto w-fit rounded-lg border border-line bg-white p-3"><QRCode value={url} size={240} level="M" /></div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-md border border-line text-brand-teal">Đóng</button>
            <button type="button" onClick={downloadQr} className="h-11 rounded-md bg-brand font-semibold text-brand-teal">Tải QR</button>
          </div>
        </div>
      </div>}
    </div>
  );
}

export default function AdminFormsPage() {
  const [forms, setForms] = useState<RegistrationForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>(() =>
    Object.fromEntries(TABLE_COLUMNS.map(({ key }) => [key, key !== "qr"])) as Record<ColumnKey, boolean>);
  const visibleColumnCount = TABLE_COLUMNS.filter(({ key }) => visibleColumns[key]).length;

  const load = async () => {
    setLoading(true);
    try {
      setForms(await listRegistrationForms());
    } catch (e: any) {
      setMsg("Lỗi tải form: " + (e?.message || "không rõ"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(publicUrl(token));
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 1500);
    } catch {
      setMsg("Không thể sao chép link");
    }
  };

  const toggleActive = async (form: RegistrationForm) => {
    setBusyId(form.id);
    try {
      const next = await updateRegistrationForm(form.id, { is_active: !form.is_active });
      setForms((prev) => prev.map((f) => (f.id === form.id ? next : f)));
      setMsg(next.is_active ? "Đã bật form" : "Đã tắt form");
    } catch (e: any) {
      setMsg("Lỗi cập nhật form: " + (e?.message || "không rõ"));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (form: RegistrationForm) => {
    if (!confirm("Xóa form này? Lịch sử submit của form cũng sẽ bị xóa. Khách đã tạo trong danh sách vẫn được giữ.")) return;
    setBusyId(form.id);
    try {
      await deleteRegistrationForm(form.id);
      setForms((prev) => prev.filter((f) => f.id !== form.id));
      setMsg("Đã xóa form");
    } catch (e: any) {
      setMsg("Lỗi xóa form: " + (e?.message || "không rõ"));
    } finally {
      setBusyId(null);
    }
  };

  const activeCount = forms.filter((f) => f.is_active).length;
  const submissionCount = forms.reduce((sum, f) => sum + (f.submission_count || 0), 0);

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-brand-teal">Form đăng ký</h1>
            <p className="text-sm text-muted mt-1">
              Quản lý link/QR form đăng ký workshop, bật/tắt form và theo dõi số lượt submit.
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="bg-brand text-brand-teal px-4 py-2 rounded-sm text-sm font-semibold whitespace-nowrap"
          >
            + Tạo Form Đăng Ký
          </button>
        </div>

        {msg && (
          <div className="mb-3 p-2 bg-brand/10 text-brand-teal rounded-sm text-sm flex items-center justify-between">
            <span>{msg}</span>
            <button onClick={() => setMsg("")} className="text-muted text-lg leading-none">×</button>
          </div>
        )}

        <div className="grid sm:grid-cols-3 gap-4 mb-4">
          <div className="bg-surface rounded-md border border-line p-4">
            <div className="text-sm text-muted">Tổng form</div>
            <div className="text-2xl font-bold text-brand-teal mt-1">{forms.length}</div>
          </div>
          <div className="bg-surface rounded-md border border-line p-4">
            <div className="text-sm text-muted">Form đang bật</div>
            <div className="text-2xl font-bold text-green-700 mt-1">{activeCount}</div>
          </div>
          <div className="bg-surface rounded-md border border-line p-4">
            <div className="text-sm text-muted">Tổng lượt submit</div>
            <div className="text-2xl font-bold text-ink mt-1">{submissionCount}</div>
          </div>
        </div>

        <section className="bg-surface rounded-md border border-line overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-semibold text-brand-teal">Danh sách form</h2>
            <div className="flex items-center gap-2">
              <ColumnVisibilityMenu columns={TABLE_COLUMNS} visible={visibleColumns} onChange={setVisibleColumns} />
              <button onClick={load} disabled={loading} className="border border-line px-3 py-2 rounded-sm text-sm disabled:opacity-50">{loading ? "Đang tải..." : "Tải lại"}</button>
            </div>
          </div>

          <div className="admin-table-scroll">
            <table className="min-w-[1100px] w-full text-sm">
              <thead className="bg-surface-muted text-muted text-xs">
                <tr>
                  {visibleColumns.workshop && <th className="text-left px-3 py-3 min-w-[220px]">Workshop</th>}
                  {visibleColumns.link && <th className="text-left px-3 py-3 min-w-[280px]">Link</th>}
                  {visibleColumns.qr && <th className="text-center px-3 py-3 w-24">QR</th>}
                  {visibleColumns.status && <th className="text-center px-3 py-3 w-28">Trạng thái</th>}
                  {visibleColumns.submissions && <th className="text-center px-3 py-3 w-28">Submit</th>}
                  {visibleColumns.created && <th className="text-left px-3 py-3 min-w-[180px]">Ngày tạo</th>}
                  {visibleColumns.actions && <th className="text-left px-3 py-3 min-w-[180px]">Thao tác</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {forms.map((f) => {
                  const url = publicUrl(f.token);
                  return (
                    <tr key={f.id} className="hover:bg-brand/5">
                      {visibleColumns.workshop && <td className="px-3 py-3 align-top">
                        <div className="font-semibold text-ink">
                          {f.workshops?.length ? `${f.workshops.length} workshop` : (f.workshop_name || "—")}
                        </div>
                        {f.workshops?.length ? (
                          <ul className="text-xs text-muted mt-1 list-disc pl-4 space-y-0.5">
                            {f.workshops.slice(0, 5).map((w) => (
                              <li key={w.id}>{w.name}</li>
                            ))}
                            {f.workshops.length > 5 && <li>+{f.workshops.length - 5} workshop khác</li>}
                          </ul>
                        ) : null}
                        {f.greeting && (
                          <div className="text-xs text-muted mt-2 line-clamp-2" title={f.greeting}>
                            {f.greeting}
                          </div>
                        )}
                      </td>}
                      {visibleColumns.link && <td className="px-3 py-3 align-top">
                        <div className="font-mono text-xs text-muted break-all">{url}</div>
                        <div className="flex gap-3 mt-2">
                          <button onClick={() => copyLink(f.token)} className="text-brand underline min-h-[28px]">
                            {copiedToken === f.token ? "Đã sao chép" : "Sao chép"}
                          </button>
                          <a href={url} target="_blank" rel="noopener noreferrer" className="text-brand-teal underline min-h-[28px]">
                            Mở form
                          </a>
                        </div>
                      </td>}
                      {visibleColumns.qr && <td className="px-3 py-3 align-top text-center">
                        <FormQr token={f.token} compact />
                      </td>}
                      {visibleColumns.status && <td className="px-3 py-3 align-top text-center">
                        <span className={`text-xs px-2 py-0.5 rounded ${f.is_active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                          {f.is_active ? "Đang bật" : "Đã tắt"}
                        </span>
                      </td>}
                      {visibleColumns.submissions && <td className="px-3 py-3 align-top text-center font-semibold text-ink">
                        {f.submission_count || 0}
                      </td>}
                      {visibleColumns.created && <td className="px-3 py-3 align-top text-muted whitespace-nowrap">
                        {formatDateTime(f.created_at)}
                      </td>}
                      {visibleColumns.actions && <td className="px-3 py-3 align-top">
                        <div className="flex items-center gap-3 flex-wrap">
                          <button
                            onClick={() => toggleActive(f)}
                            disabled={busyId === f.id}
                            className="text-brand underline min-h-[32px] disabled:opacity-50"
                          >
                            {f.is_active ? "Tắt" : "Bật"}
                          </button>
                          <button
                            onClick={() => remove(f)}
                            disabled={busyId === f.id}
                            className="text-red-600 underline min-h-[32px] disabled:opacity-50"
                          >
                            Xóa
                          </button>
                        </div>
                      </td>}
                    </tr>
                  );
                })}
                {!forms.length && !loading && (
                  <tr>
                    <td colSpan={visibleColumnCount} className="py-10 text-center text-muted">
                      Chưa có form đăng ký nào. Bấm “Tạo Form Đăng Ký” để tạo form đầu tiên.
                    </td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td colSpan={visibleColumnCount} className="py-10 text-center text-muted">Đang tải danh sách form...</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <CreateRegistrationFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(form) => setForms((prev) => [form, ...prev])}
      />
    </div>
  );
}
