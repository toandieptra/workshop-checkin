"use client";

// Quản lý block Smax (Zalo User): xem / tạo / sửa / xoá block ngay trong workshop. Block được lưu trên Smax
// (dùng chung với "Broadcast & Re-marketing" của Smax) và dùng cho Broadcast Zalo ở trang Khách mời.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiForm } from "@/lib/api";
import { apiPath } from "@/lib/survey-admin";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";

type Message = { text: string; images: string[] };
type Block = { id: string; name: string; group_id: string | null; folder: string | null; updated_at: string | null; messages: Message[] | null; other_cards?: number };
type Folder = { id: string; name: string };
type Status = { configured: boolean; biz: string | null; user_token: boolean; user_token_expires_at: string | null; user_token_expired: boolean };

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const errText = (e: unknown) => (e instanceof Error ? e.message : "Thao tác thất bại");

export default function SmaxBlocksPanel() {
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.zaloTemplatesCreate) || can(PERMISSIONS.zaloTemplatesEdit) || can(PERMISSIONS.zaloTemplatesManage);
  const canDelete = can(PERMISSIONS.zaloTemplatesManage) || can(PERMISSIONS.zaloTemplatesEdit);
  const [status, setStatus] = useState<Status | null>(null);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Block | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      const [st, list] = await Promise.all([
        api<Status>(apiPath("/api/smax/status"), { adminLoading: false }),
        api<{ blocks: Block[]; folders: Folder[] }>(apiPath("/api/smax/blocks"), { adminLoading: false }),
      ]);
      setStatus(st); setBlocks(list.blocks); setFolders(list.folders); setError(null);
    } catch (e) { setError(errText(e)); setBlocks((b) => b || []); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => (blocks || []).filter((b) =>
    (!folder || b.group_id === folder) && (!q.trim() || b.name.toLowerCase().includes(q.trim().toLowerCase()))), [blocks, folder, q]);

  const expiresSoon = status?.user_token_expires_at && new Date(status.user_token_expires_at).getTime() - Date.now() < 3 * 86400_000;

  const openBlock = async (b: Block) => {
    try { setEditing(await api<Block>(apiPath(`/api/smax/blocks/${encodeURIComponent(b.id)}`))); }
    catch (e) { setError(errText(e)); }
  };

  if (status && !status.configured) return <p className="rounded-md border border-line bg-white p-4 text-sm text-muted">Chưa có Partner API token Smax — dán ở Cài đặt → Kết nối → Token Smax.</p>;

  return <div className="space-y-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
    {status && (!status.user_token || status.user_token_expired || expiresSoon) && <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <div className="font-semibold">
        {!status.user_token ? "Chưa có token đăng nhập Smax — chưa tạo/sửa block được."
          : status.user_token_expired ? "Token đăng nhập Smax đã hết hạn — chưa tạo/sửa block được."
          : `Token đăng nhập Smax sắp hết hạn (${fmt(status.user_token_expires_at)}).`}
      </div>
      <p className="mt-1">Dán token đăng nhập Smax mới ở <a href="/admin/cai-dat?tab=ket-noi" className="font-semibold underline">Cài đặt → Kết nối → Token Smax</a>. Xem và gửi block vẫn hoạt động.</p>
    </div>}

    <section className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-heading font-bold text-ink">Block Smax · Zalo User</h3>
          <p className="mt-0.5 text-xs text-muted">{blocks ? `${blocks.length} block trên Smax ${status?.biz || ""}` : "Đang tải…"}
            {status?.user_token_expires_at && !status.user_token_expired ? ` · token hết hạn ${fmt(status.user_token_expires_at)}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm block…" className="min-h-10 rounded-md border border-line px-3 text-sm" />
          <select value={folder} onChange={(e) => setFolder(e.target.value)} className="min-h-10 rounded-md border border-line bg-white px-3 text-sm">
            <option value="">Tất cả thư mục</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          {canWrite && <button type="button" onClick={() => setEditing("new")} disabled={!status?.user_token || status.user_token_expired}
            className="min-h-10 rounded-md bg-brand px-4 text-sm font-semibold text-brand-teal disabled:opacity-40">Tạo block</button>}
        </div>
      </div>
      {error && <p role="alert" className="border-b border-line bg-red-50 px-4 py-2 text-sm text-error">{error}</p>}
      <div className="divide-y divide-line">
        {blocks && shown.length === 0 && <p className="p-4 text-sm text-muted">Không có block phù hợp.</p>}
        {shown.map((b) => <button key={b.id} type="button" onClick={() => void openBlock(b)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-muted">
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{b.name}</div>
            <div className="text-xs text-muted">{b.folder || "Không có thư mục"} · cập nhật {fmt(b.updated_at)}</div>
          </div>
          <span className="shrink-0 text-xs font-semibold text-brand-accent">{canWrite ? "Xem / sửa" : "Xem"}</span>
        </button>)}
      </div>
    </section>

    {editing && <BlockEditor block={editing === "new" ? null : editing} folders={folders} readOnly={!canWrite || !status?.user_token || !!status?.user_token_expired}
      canDelete={canDelete && !!status?.user_token && !status?.user_token_expired}
      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
  </div>;
}

function BlockEditor({ block, folders, readOnly, canDelete, onClose, onSaved }: {
  block: Block | null; folders: Folder[]; readOnly: boolean; canDelete: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(block?.name || "");
  const [groupId, setGroupId] = useState(block?.group_id || "");
  const [messages, setMessages] = useState<Message[]>(block?.messages?.length ? block.messages.map((m) => ({ ...m, images: [...m.images] })) : [{ text: "", images: [] }]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = (i: number, patch: Partial<Message>) => setMessages((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const upload = async (i: number, files: FileList | null) => {
    if (!files?.length) return;
    setUploading(i); setError(null);
    try {
      for (const f of Array.from(files)) {
        const form = new FormData(); form.append("file", f);
        const res = await apiForm<{ url: string }>(apiPath("/api/smax/images"), form);
        setMessages((ms) => ms.map((m, j) => (j === i ? { ...m, images: [...m.images, res.url].slice(0, 10) } : m)));
      }
    } catch (e) { setError(errText(e)); } finally { setUploading(null); }
  };
  const valid = name.trim() && messages.every((m) => m.text.trim() || m.images.length);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const body = JSON.stringify({ name: name.trim(), group_id: groupId || null, messages });
      if (block) await api(apiPath(`/api/smax/blocks/${encodeURIComponent(block.id)}`), { method: "PUT", headers: { "Content-Type": "application/json" }, body });
      else await api(apiPath("/api/smax/blocks"), { method: "POST", headers: { "Content-Type": "application/json" }, body });
      onSaved();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!block) return;
    setBusy(true); setError(null);
    try { await api(apiPath(`/api/smax/blocks/${encodeURIComponent(block.id)}`), { method: "DELETE" }); onSaved(); }
    catch (e) { setError(errText(e)); setBusy(false); }
  };

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label="Block Smax" className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-lg bg-surface shadow-xl sm:rounded-lg">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="font-heading text-lg font-bold text-ink">{block ? (readOnly ? "Xem block" : "Sửa block") : "Tạo block Zalo User"}</h2>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Đóng" className="min-h-10 min-w-10 text-2xl leading-none text-muted">×</button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-error">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="font-semibold text-text-secondary">Tên block
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} placeholder="VD: Spam ngày 19-08-2026" className="mt-1 min-h-10 w-full rounded-md border border-line px-3 font-normal" />
          </label>
          <label className="font-semibold text-text-secondary">Thư mục
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={readOnly} className="mt-1 min-h-10 w-full rounded-md border border-line bg-white px-3 font-normal">
              <option value="">Không có thư mục</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
        </div>
        {block?.other_cards ? <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">Block còn {block.other_cards} thẻ loại khác (kết bạn, form…) — chỉ sửa được các tin chữ/ảnh; thẻ khác giữ nguyên trên Smax.</p> : null}
        {messages.map((m, i) => <div key={i} className="rounded-md border border-line p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-ink">Tin {i + 1}</span>
            {!readOnly && messages.length > 1 && <button type="button" onClick={() => setMessages((ms) => ms.filter((_, j) => j !== i))} className="text-xs font-semibold text-error">Xoá tin</button>}
          </div>
          <textarea value={m.text} onChange={(e) => update(i, { text: e.target.value })} disabled={readOnly} rows={3} maxLength={2000}
            placeholder="Nội dung chữ (để trống nếu chỉ gửi ảnh). Biến: {{name}}, {{workshop_name}}, {{workshop_date}}…" className="w-full rounded-md border border-line px-3 py-2" />
          <div className="mt-2 flex flex-wrap gap-2">
            {m.images.map((u, k) => <div key={u + k} className="relative">
              <img src={u} alt="" className="h-20 w-20 rounded object-cover" />
              {!readOnly && <button type="button" onClick={() => update(i, { images: m.images.filter((_, x) => x !== k) })} aria-label="Bỏ ảnh"
                className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-xs text-white">×</button>}
            </div>)}
            {!readOnly && m.images.length < 10 && <label className="grid h-20 w-20 cursor-pointer place-items-center rounded border border-dashed border-line text-center text-xs text-muted hover:border-brand">
              {uploading === i ? "Đang tải…" : "+ Ảnh"}
              <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple className="hidden" onChange={(e) => { void upload(i, e.target.files); e.target.value = ""; }} />
            </label>}
          </div>
        </div>)}
        {!readOnly && messages.length < 10 && <button type="button" onClick={() => setMessages((ms) => [...ms, { text: "", images: [] }])} className="min-h-10 w-full rounded-md border border-dashed border-line font-semibold text-text-secondary hover:border-brand">+ Thêm tin</button>}
        <p className="text-xs text-muted">Mỗi tin gửi chữ trước rồi ảnh (Smax không gửi chữ kèm ảnh trong cùng một tin). Hướng dẫn Smax khuyên Broadcast chỉ gửi ảnh.</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
        {block && canDelete && (confirmDelete ? <>
          <span className="mr-auto text-sm font-semibold text-error">Xoá block “{block.name}” khỏi Smax?</span>
          <button type="button" onClick={() => setConfirmDelete(false)} disabled={busy} className="min-h-10 rounded-md border border-line px-3 font-semibold">Không</button>
          <button type="button" onClick={() => void remove()} disabled={busy} className="min-h-10 rounded-md bg-red-600 px-3 font-semibold text-white">Xoá</button>
        </> : <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy} className="mr-auto min-h-10 rounded-md border border-red-200 px-3 font-semibold text-red-600">Xoá block</button>)}
        {!confirmDelete && <>
          <button type="button" onClick={onClose} disabled={busy} className="min-h-10 rounded-md border border-line px-4 font-semibold">{readOnly ? "Đóng" : "Huỷ"}</button>
          {!readOnly && <button type="button" onClick={() => void save()} disabled={busy || !valid || uploading !== null} className="min-h-10 rounded-md bg-brand px-4 font-bold text-brand-teal disabled:opacity-40">{busy ? "Đang lưu…" : "Lưu lên Smax"}</button>}
        </>}
      </div>
    </div>
  </div>;
}
