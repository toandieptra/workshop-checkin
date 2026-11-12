"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { catalogApi, fmtDateTime, type CatalogCategory, type CatalogEntry, type CatalogKind, type CatalogStatus } from "@/lib/survey-admin";

const STATUS_LABEL: Record<CatalogStatus, string> = { active: "Đang dùng", inactive: "Tạm ẩn", archived: "Lưu trữ" };
const STATUS_CLASS: Record<CatalogStatus, string> = {
  active: "bg-success-soft text-success border-success-border", inactive: "bg-amber-50 text-warning border-amber-200", archived: "bg-surface-muted text-muted border-line",
};

function categoryLabel(categories: CatalogCategory[], id: string | null): string {
  if (!id) return "—";
  const c = categories.find((x) => x.id === id);
  if (!c) return "—";
  const parent = c.parent_id ? categories.find((x) => x.id === c.parent_id) : null;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

function CategoryOptions({ categories }: { categories: CatalogCategory[] }) {
  const tops = categories.filter((c) => !c.parent_id);
  return (
    <>
      {tops.map((t) => (
        <optgroup key={t.id} label={t.name}>
          <option value={t.id}>{t.name}</option>
          {categories.filter((c) => c.parent_id === t.id).map((c) => <option key={c.id} value={c.id}>{t.name} › {c.name}</option>)}
        </optgroup>
      ))}
    </>
  );
}

export default function CatalogPage() {
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.catalogManage);
  const [tab, setTab] = useState<CatalogKind | "categories">("products");
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [rows, setRows] = useState<CatalogEntry[]>([]);
  const [products, setProducts] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState<CatalogEntry | "new" | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const seq = useRef(0);

  const loadCategories = useCallback(async () => setCategories(await catalogApi.categories()), []);
  const load = useCallback(async () => {
    if (tab === "categories") return;
    const id = ++seq.current;
    setLoading(true);
    try {
      const data = await catalogApi.list(tab, { q, category_id: cat, status });
      if (id === seq.current) setRows(data);
    } catch (e: any) {
      if (id === seq.current) setMsg({ tone: "err", text: e?.message || "Không tải được danh mục" });
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [tab, q, cat, status]);

  useEffect(() => { void loadCategories().catch(() => {}); }, [loadCategories]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 200); return () => clearTimeout(t); }, [load]);
  useEffect(() => { if (tab === "recipes") void catalogApi.list("products").then(setProducts).catch(() => {}); }, [tab]);

  const kindLabel = tab === "recipes" ? "công thức" : "sản phẩm";

  return (
    <div className="px-3 py-3 pb-20 sm:p-6 md:flex md:h-[calc(var(--admin-vh)_-_3.5rem)] md:flex-col md:pb-px">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between md:shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-brand-teal">Sản phẩm &amp; công thức</h1>
          <p className="mt-1 text-sm text-muted">Danh mục dùng chung cho mọi workshop. Mỗi khảo sát chọn món từ đây — không tạo bản sao.</p>
        </div>
        {canManage && tab !== "categories" && (
          <button type="button" onClick={() => setEditing("new")} className="min-h-11 rounded-md bg-brand px-4 text-sm font-semibold text-brand-teal">+ Thêm {kindLabel}</button>
        )}
      </div>

      <div role="tablist" aria-label="Loại danh mục" className="mb-3 flex gap-1 border-b border-line md:shrink-0">
        {([["products", "Sản phẩm"], ["recipes", "Công thức"], ["categories", "Danh mục"]] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setEditing(null); }}
            className={`min-h-11 px-4 text-sm font-semibold border-b-2 -mb-px ${tab === key ? "border-brand text-brand-teal" : "border-transparent text-muted hover:text-brand-teal"}`}>{label}</button>
        ))}
      </div>

      {msg && (
        <div role={msg.tone === "ok" ? "status" : "alert"} className={`mb-3 rounded-md border px-4 py-2 text-sm md:shrink-0 ${msg.tone === "ok" ? "border-success-border bg-success-soft text-success" : "border-red-200 bg-red-50 text-error"}`}>
          {msg.text} <button type="button" className="ml-2 underline" onClick={() => setMsg(null)}>Đóng</button>
        </div>
      )}

      {tab === "categories" ? (
        <CategoryManager categories={categories} canManage={canManage} onChange={loadCategories} onMessage={setMsg} />
      ) : (
        <>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row md:shrink-0">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Tìm ${kindLabel} (gõ không dấu được)`} aria-label="Tìm kiếm"
              className="min-h-11 flex-1 rounded-md border border-line bg-surface px-3 text-sm" />
            <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Lọc danh mục" className="min-h-11 rounded-md border border-line bg-surface px-3 text-sm">
              <option value="">Tất cả danh mục</option>
              <CategoryOptions categories={categories} />
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Lọc trạng thái" className="min-h-11 rounded-md border border-line bg-surface px-3 text-sm">
              <option value="all">Đang dùng + tạm ẩn</option>
              <option value="active">Đang dùng</option>
              <option value="inactive">Tạm ẩn</option>
              <option value="archived">Lưu trữ</option>
            </select>
          </div>
          <div className="admin-table-scroll overflow-x-auto rounded-md border border-line bg-surface md:min-h-0 md:max-h-none md:flex-1">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase text-muted">
                <tr>
                  <th className="px-3 py-2 w-16">Ảnh</th><th className="px-3 py-2">Tên</th><th className="px-3 py-2">Danh mục</th>
                  <th className="px-3 py-2">Trạng thái</th><th className="px-3 py-2 text-right">Ảnh</th>
                  {tab === "products" ? <th className="px-3 py-2 text-right">Công thức</th> : <th className="px-3 py-2 text-right">Sản phẩm</th>}
                  <th className="px-3 py-2 text-right">Khảo sát</th><th className="px-3 py-2">Cập nhật</th>
                </tr>
              </thead>
              <tbody>
                {loading && !rows.length && Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-t border-line"><td colSpan={8} className="px-3 py-3"><div className="h-10 animate-pulse rounded bg-surface-muted" /></td></tr>
                ))}
                {!loading && !rows.length && (
                  <tr><td colSpan={8} className="px-3 py-10 text-center text-muted">Chưa có {kindLabel} nào{q ? ` khớp “${q}”` : ""}.</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer border-t border-line hover:bg-surface-muted/60" onClick={() => setEditing(r)}>
                    <td className="px-3 py-2">
                      {r.images[0] ? <img src={r.images[0].thumb_url} alt="" className="h-12 w-12 rounded object-cover" style={{ objectPosition: `center ${r.images[0].focus_y}%` }} />
                        : <div className="grid h-12 w-12 place-items-center rounded bg-surface-muted text-[10px] text-muted">Chưa ảnh</div>}
                    </td>
                    <td className="px-3 py-2 font-semibold text-brand-teal">
                      <button type="button" className="text-left hover:underline" onClick={(e) => { e.stopPropagation(); setEditing(r); }}>{r.name}</button>
                    </td>
                    <td className="px-3 py-2 text-muted">{categoryLabel(categories, r.category_id)}</td>
                    <td className="px-3 py-2"><span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                    <td className="px-3 py-2 text-right">{r.images.length}</td>
                    <td className="px-3 py-2 text-right">{tab === "products" ? r.recipe_count || 0 : r.product_ids?.length || 0}</td>
                    <td className="px-3 py-2 text-right">{r.survey_usage}</td>
                    <td className="px-3 py-2 text-muted">{fmtDateTime(r.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && tab !== "categories" && (
        <EntryEditor kind={tab} entry={editing === "new" ? null : editing} categories={categories} products={products} canManage={canManage}
          onClose={() => setEditing(null)}
          onSaved={(entry, text) => { setMsg({ tone: "ok", text }); setEditing(entry); void load(); }}
          onDeleted={(text) => { setMsg({ tone: "ok", text }); setEditing(null); void load(); }} />
      )}
    </div>
  );
}

function CategoryManager({ categories, canManage, onChange, onMessage }: {
  categories: CatalogCategory[]; canManage: boolean; onChange: () => Promise<void>; onMessage: (m: { tone: "ok" | "err"; text: string }) => void;
}) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const tops = categories.filter((c) => !c.parent_id);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); await onChange(); onMessage({ tone: "ok", text: ok }); } catch (e: any) { onMessage({ tone: "err", text: e?.message || "Thao tác thất bại" }); }
  };
  const row = (c: CatalogCategory, child = false) => (
    <li key={c.id} className={`flex items-center gap-2 border-t border-line px-3 py-2 ${child ? "pl-8" : ""}`}>
      {editId === c.id ? (
        <>
          <input value={editName} onChange={(e) => setEditName(e.target.value)} aria-label="Tên danh mục" className="min-h-10 flex-1 rounded-md border border-line px-2 text-sm" />
          <button type="button" className="min-h-10 rounded-md bg-brand px-3 text-sm font-semibold text-brand-teal" onClick={() => run(() => catalogApi.updateCategory(c.id, { name: editName }), "Đã đổi tên danh mục").then(() => setEditId(null))}>Lưu</button>
          <button type="button" className="min-h-10 px-2 text-sm text-muted" onClick={() => setEditId(null)}>Huỷ</button>
        </>
      ) : (
        <>
          <span className={`flex-1 ${child ? "" : "font-semibold text-brand-teal"}`}>{child ? "↳ " : ""}{c.name}</span>
          <span className="text-xs text-muted">{c.product_count} SP · {c.recipe_count} CT</span>
          {!c.is_active && <span className="rounded-full bg-surface-muted px-2 text-xs text-muted">Tạm ẩn</span>}
          {canManage && (
            <>
              <button type="button" className="min-h-10 px-2 text-sm text-brand-accent hover:underline" onClick={() => { setEditId(c.id); setEditName(c.name); }}>Sửa</button>
              <button type="button" className="min-h-10 px-2 text-sm text-muted hover:underline" onClick={() => run(() => catalogApi.updateCategory(c.id, { is_active: !c.is_active }), c.is_active ? "Đã ẩn danh mục" : "Đã hiện danh mục")}>{c.is_active ? "Ẩn" : "Hiện"}</button>
              <button type="button" className="min-h-10 px-2 text-sm text-error hover:underline" onClick={() => { if (window.confirm(`Xoá danh mục “${c.name}”?`)) void run(() => catalogApi.deleteCategory(c.id), "Đã xoá danh mục"); }}>Xoá</button>
            </>
          )}
        </>
      )}
    </li>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px] md:min-h-0 md:flex-1 md:overflow-y-auto md:content-start">
      <ul className="overflow-hidden rounded-md border border-line bg-surface text-sm">
        <li className="bg-surface-muted px-3 py-2 text-xs font-semibold uppercase text-muted">Cây danh mục (tối đa 2 cấp)</li>
        {tops.length === 0 && <li className="px-3 py-8 text-center text-muted">Chưa có danh mục.</li>}
        {tops.map((t) => [row(t), ...categories.filter((c) => c.parent_id === t.id).map((c) => row(c, true))])}
      </ul>
      {canManage && (
        <form className="flex h-fit flex-col gap-3 rounded-md border border-line bg-surface p-4" onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void run(() => catalogApi.createCategory({ name: name.trim(), parent_id: parent || null }), "Đã thêm danh mục").then(() => setName(""));
        }}>
          <h2 className="font-heading text-base font-bold text-brand-teal">Thêm danh mục</h2>
          <label className="text-sm font-semibold">Tên<input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-line px-3 font-normal" placeholder="VD: Topping" /></label>
          <label className="text-sm font-semibold">Thuộc nhóm
            <select value={parent} onChange={(e) => setParent(e.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-line px-3 font-normal">
              <option value="">— Danh mục cấp 1 —</option>
              {tops.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <button type="submit" className="min-h-11 rounded-md bg-brand px-4 text-sm font-semibold text-brand-teal">Thêm</button>
        </form>
      )}
    </div>
  );
}

function EntryEditor({ kind, entry, categories, products, canManage, onClose, onSaved, onDeleted }: {
  kind: CatalogKind; entry: CatalogEntry | null; categories: CatalogCategory[]; products: CatalogEntry[]; canManage: boolean;
  onClose: () => void; onSaved: (e: CatalogEntry, text: string) => void; onDeleted: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(true, ref);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const [name, setName] = useState(entry?.name || "");
  const [categoryId, setCategoryId] = useState(entry?.category_id || "");
  const [desc, setDesc] = useState(entry?.short_description || "");
  const [instructions, setInstructions] = useState(entry?.instructions || "");
  const [status, setStatus] = useState<CatalogStatus>(entry?.status || "active");
  const [linked, setLinked] = useState<string[]>(entry?.product_ids || []);
  const [productQuery, setProductQuery] = useState("");
  const [images, setImages] = useState(entry?.images || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setImages(entry?.images || []); }, [entry]);

  const save = async () => {
    if (!name.trim()) { setError("Nhập tên trước khi lưu."); return; }
    setBusy(true); setError(null);
    const body: Record<string, unknown> = { name: name.trim(), short_description: desc, status };
    if (categoryId) body.category_id = categoryId; else if (entry) body.clear_category = true;
    if (kind === "recipes") { body.instructions = instructions; body.product_ids = linked; }
    try {
      const saved = entry ? await catalogApi.update(kind, entry.id, body) : await catalogApi.create(kind, body);
      onSaved(saved, entry ? "Đã lưu thay đổi" : "Đã thêm — giờ có thể tải ảnh lên");
    } catch (e: any) { setError(e?.message || "Lưu thất bại"); } finally { setBusy(false); }
  };
  const upload = async (files: FileList | null) => {
    if (!entry || !files?.length) return;
    setBusy(true); setError(null);
    try { const saved = await catalogApi.upload(kind, entry.id, Array.from(files)); setImages(saved.images); onSaved(saved, `Đã tải ${files.length} ảnh`); }
    catch (e: any) { setError(e?.message || "Tải ảnh thất bại"); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const move = async (index: number, delta: number) => {
    if (!entry) return;
    const next = [...images];
    const [it] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, it);
    setImages(next);
    try { const saved = await catalogApi.reorderImages(kind, entry.id, next.map((i) => i.id)); setImages(saved.images); } catch (e: any) { setError(e?.message || "Không sắp xếp được"); }
  };
  const remove = async () => {
    if (!entry || !window.confirm(`Xoá vĩnh viễn “${entry.name}”? Không thể hoàn tác.`)) return;
    setBusy(true);
    try { await catalogApi.remove(kind, entry.id); onDeleted("Đã xoá"); } catch (e: any) { setError(e?.message || "Không xoá được"); } finally { setBusy(false); }
  };
  const filteredProducts = useMemo(() => {
    const key = productQuery.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase();
    return products.filter((p) => !key || p.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase().includes(key)).slice(0, 60);
  }, [products, productQuery]);
  const disabled = !canManage || busy;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="entry-title" className="flex h-full w-full max-w-xl flex-col bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 id="entry-title" className="font-heading text-lg font-bold text-brand-teal">{entry ? entry.name : `Thêm ${kind === "recipes" ? "công thức" : "sản phẩm"}`}</h2>
          <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-md text-xl text-muted" aria-label="Đóng">×</button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-error">{error}</div>}
          <label className="block font-semibold">Tên hiển thị <span className="text-error">*</span>
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} maxLength={200} className="mt-1 min-h-11 w-full rounded-md border border-line px-3 font-normal" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block font-semibold">Danh mục
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={disabled} className="mt-1 min-h-11 w-full rounded-md border border-line px-3 font-normal">
                <option value="">— Chưa phân loại —</option>
                <CategoryOptions categories={categories} />
              </select>
            </label>
            <label className="block font-semibold">Trạng thái
              <select value={status} onChange={(e) => setStatus(e.target.value as CatalogStatus)} disabled={disabled} className="mt-1 min-h-11 w-full rounded-md border border-line px-3 font-normal">
                <option value="active">Đang dùng</option><option value="inactive">Tạm ẩn (không chọn mới được)</option><option value="archived">Lưu trữ</option>
              </select>
            </label>
          </div>
          <label className="block font-semibold">Mô tả ngắn
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} disabled={disabled} rows={2} maxLength={1000} className="mt-1 w-full rounded-md border border-line px-3 py-2 font-normal" />
          </label>
          {kind === "recipes" && (
            <>
              <label className="block font-semibold">Hướng dẫn / công thức
                <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} disabled={disabled} rows={5} className="mt-1 w-full rounded-md border border-line px-3 py-2 font-normal" />
              </label>
              <fieldset className="rounded-md border border-line p-3">
                <legend className="px-1 font-semibold">Sản phẩm dùng trong công thức ({linked.length})</legend>
                <div className="mb-2 flex flex-wrap gap-1">
                  {linked.map((id) => {
                    const p = products.find((x) => x.id === id);
                    return <span key={id} className="inline-flex items-center gap-1 rounded-full bg-cyan-bg px-2 py-1 text-xs">{p?.name || "(đã xoá)"}
                      {!disabled && <button type="button" aria-label={`Bỏ ${p?.name}`} onClick={() => setLinked(linked.filter((x) => x !== id))} className="px-1">×</button>}</span>;
                  })}
                </div>
                {!disabled && (
                  <>
                    <input type="search" value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Tìm sản phẩm để liên kết" aria-label="Tìm sản phẩm" className="min-h-10 w-full rounded-md border border-line px-3" />
                    <div className="mt-2 max-h-40 overflow-y-auto">
                      {filteredProducts.filter((p) => !linked.includes(p.id)).map((p) => (
                        <button key={p.id} type="button" onClick={() => setLinked([...linked, p.id])} className="block min-h-9 w-full rounded px-2 text-left hover:bg-surface-muted">+ {p.name}</button>
                      ))}
                    </div>
                  </>
                )}
              </fieldset>
            </>
          )}

          <section className="rounded-md border border-line p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">Hình ảnh ({images.length}/12)</h3>
              {entry && canManage && (
                <>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
                  <button type="button" disabled={busy || images.length >= 12} onClick={() => fileRef.current?.click()} className="min-h-10 rounded-md border border-brand px-3 text-sm font-semibold text-brand-accent disabled:opacity-50">{busy ? "Đang xử lý…" : "+ Tải ảnh"}</button>
                </>
              )}
            </div>
            {!entry && <p className="text-muted">Lưu trước, sau đó tải ảnh lên. Ảnh được tự chuyển sang WebP (thẻ 480px, gallery 1080px).</p>}
            {entry && !images.length && <p className="text-muted">Chưa có ảnh — survey sẽ hiện placeholder “Ảnh đang cập nhật”.</p>}
            <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {images.map((img, i) => (
                <li key={img.id} className="overflow-hidden rounded-md border border-line">
                  <div className="relative aspect-[1/1.05] bg-surface-muted">
                    <img src={img.thumb_url} alt={img.alt || ""} className="h-full w-full object-cover" style={{ objectPosition: `center ${img.focus_y}%` }} />
                    {i === 0 && <span className="absolute left-1 top-1 rounded bg-brand-teal px-1.5 text-[10px] font-semibold text-white">Ảnh chính</span>}
                  </div>
                  {canManage && (
                    <div className="space-y-1 p-2 text-xs">
                      <label className="flex items-center gap-1">Khung
                        <input type="range" min={0} max={100} defaultValue={img.focus_y} aria-label="Vị trí khung cắt dọc"
                          onChange={(e) => setImages(images.map((x) => (x.id === img.id ? { ...x, focus_y: Number(e.target.value) } : x)))}
                          onMouseUp={(e) => void catalogApi.updateImage(img.id, { focus_y: Number((e.target as HTMLInputElement).value) })}
                          onTouchEnd={(e) => void catalogApi.updateImage(img.id, { focus_y: Number((e.target as HTMLInputElement).value) })}
                          onKeyUp={(e) => void catalogApi.updateImage(img.id, { focus_y: Number((e.target as HTMLInputElement).value) })} className="flex-1" />
                      </label>
                      <div className="flex justify-between">
                        <button type="button" disabled={i === 0} onClick={() => void move(i, -1)} className="min-h-8 px-1 disabled:opacity-30" aria-label="Đưa lên trước">←</button>
                        {i !== 0 && <button type="button" onClick={() => void move(i, -i)} className="min-h-8 px-1 text-brand-accent">Đặt làm chính</button>}
                        <button type="button" disabled={i === images.length - 1} onClick={() => void move(i, 1)} className="min-h-8 px-1 disabled:opacity-30" aria-label="Đưa ra sau">→</button>
                        <button type="button" onClick={async () => {
                          if (!window.confirm("Xoá ảnh này?")) return;
                          try { await catalogApi.deleteImage(img.id); setImages(images.filter((x) => x.id !== img.id)); } catch (e: any) { setError(e?.message || "Không xoá được ảnh"); }
                        }} className="min-h-8 px-1 text-error">Xoá</button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section>
          {entry && <p className="text-xs text-muted">Đang dùng trong {entry.survey_usage} khảo sát. Đổi tên/ảnh sẽ áp dụng cho lần xuất bản khảo sát kế tiếp; phiếu đã gửi giữ nguyên tên lúc gửi.</p>}
        </div>
        {canManage && (
          <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
            {entry ? (
              <button type="button" onClick={remove} disabled={busy || entry.survey_usage > 0} title={entry.survey_usage ? "Đang dùng trong khảo sát — hãy chuyển sang Lưu trữ" : undefined}
                className="min-h-11 rounded-md px-3 text-sm font-semibold text-error disabled:opacity-40">Xoá</button>
            ) : <span />}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="min-h-11 rounded-md border border-line px-4 text-sm">Đóng</button>
              <button type="button" onClick={save} disabled={busy} className="min-h-11 rounded-md bg-brand px-5 text-sm font-semibold text-brand-teal disabled:opacity-60">{busy ? "Đang lưu…" : "Lưu"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
