"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { catalogApi, surveyAdminApi, TINTS, type CatalogCategory, type PickerItem, type StructureGroup, type StructureItem, type SurveyAdmin } from "@/lib/survey-admin";

const newKey = () => `new-${Math.random().toString(36).slice(2, 9)}`;
const strip = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase();

export default function StructureTab({ workshopId, survey, canManage, onSaved, onError }: {
  workshopId: string; survey: SurveyAdmin; canManage: boolean; onSaved: (t: string) => Promise<void>; onError: (t: string) => void;
}) {
  const [groups, setGroups] = useState<StructureGroup[]>(survey.groups);
  const [items, setItems] = useState<StructureItem[]>(survey.items);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [pool, setPool] = useState<PickerItem[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [target, setTarget] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);

  useEffect(() => { setGroups(survey.groups); setItems(survey.items); setDirty(false); }, [survey]);
  useEffect(() => { catalogApi.categories().then(setCategories).catch(() => {}); catalogApi.picker().then(setPool).catch((e) => onError(e?.message || "Không tải được danh mục")); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tops = groups.filter((g) => !g.parent_key);
  const childrenOf = (key: string) => groups.filter((g) => g.parent_key === key);
  const used = useMemo(() => new Set(items.map((i) => `${i.item_type}:${i.source_id}`)), [items]);
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name || "";
  const visiblePool = useMemo(() => {
    const key = strip(q.trim());
    const catIds = catFilter ? new Set([catFilter, ...categories.filter((c) => c.parent_id === catFilter).map((c) => c.id)]) : null;
    return pool.filter((p) => (!type || p.item_type === type) && (!catIds || (p.category_id && catIds.has(p.category_id))) && (!key || strip(p.name).includes(key)));
  }, [pool, q, type, catFilter, categories]);

  const touch = () => setDirty(true);
  const addGroup = (parent: string | null) => {
    const title = window.prompt(parent ? "Tên phân nhóm (VD: Trân châu 2 lớp)" : "Tên nhóm (VD: Topping)");
    if (!title?.trim()) return;
    const key = newKey();
    setGroups([...groups, { key, title: title.trim(), short_title: null, tint: parent ? null : TINTS[tops.length % 4].value, parent_key: parent }]);
    setTarget(key); touch();
  };
  const moveGroup = (key: string, delta: number) => {
    const g = groups.find((x) => x.key === key)!;
    const siblings = groups.filter((x) => x.parent_key === g.parent_key);
    const i = siblings.indexOf(g), j = i + delta;
    if (j < 0 || j >= siblings.length) return;
    const other = siblings[j];
    const next = [...groups];
    const a = next.indexOf(g), b = next.indexOf(other);
    [next[a], next[b]] = [next[b], next[a]];
    setGroups(next); touch();
  };
  const removeGroup = (key: string) => {
    const kids = childrenOf(key).map((c) => c.key);
    const affected = items.filter((i) => i.group_key === key || kids.includes(i.group_key || "")).length;
    if (!window.confirm(`Xoá nhóm này${kids.length ? ` và ${kids.length} phân nhóm` : ""}? ${affected} món sẽ chuyển sang “Khác”.`)) return;
    setGroups(groups.filter((g) => g.key !== key && !kids.includes(g.key)));
    setItems(items.map((i) => (i.group_key === key || kids.includes(i.group_key || "") ? { ...i, group_key: null } : i))); touch();
  };
  const addItem = (p: PickerItem) => {
    setItems([...items, { item_type: p.item_type, source_id: p.source_id, group_key: target || null, display_name: null, catalog_name: p.name, catalog_status: p.status, thumb_url: p.thumb_url, image_count: p.image_count }]);
    touch();
  };
  const addAllVisible = () => {
    const fresh = visiblePool.filter((p) => !used.has(`${p.item_type}:${p.source_id}`));
    setItems([...items, ...fresh.map((p) => ({ item_type: p.item_type, source_id: p.source_id, group_key: target || null, display_name: null, catalog_name: p.name, catalog_status: p.status, thumb_url: p.thumb_url, image_count: p.image_count }))]);
    touch();
  };
  const buildFromCategories = () => {
    if (groups.length && !window.confirm("Tạo lại nhóm theo danh mục catalog? Nhóm hiện có sẽ bị thay thế.")) return;
    const needed = new Set(items.map((i) => pool.find((p) => p.item_type === i.item_type && p.source_id === i.source_id)?.category_id).filter(Boolean) as string[]);
    const catTops = categories.filter((c) => !c.parent_id && (needed.has(c.id) || categories.some((x) => x.parent_id === c.id && needed.has(x.id))));
    const next: StructureGroup[] = [];
    const map = new Map<string, string>();
    catTops.forEach((t, i) => {
      const key = newKey(); map.set(t.id, key);
      next.push({ key, title: t.name, short_title: null, tint: TINTS[i % 4].value, parent_key: null });
      categories.filter((c) => c.parent_id === t.id && needed.has(c.id)).forEach((c) => {
        const ck = newKey(); map.set(c.id, ck);
        next.push({ key: ck, title: c.name, short_title: null, tint: null, parent_key: key });
      });
    });
    setGroups(next);
    setItems(items.map((i) => {
      const cid = pool.find((p) => p.item_type === i.item_type && p.source_id === i.source_id)?.category_id;
      return { ...i, group_key: (cid && map.get(cid)) || null };
    }));
    touch();
  };
  const moveItem = (index: number, delta: number) => {
    const it = items[index];
    const same = items.map((x, i) => [x, i] as const).filter(([x]) => x.group_key === it.group_key).map(([, i]) => i);
    const pos = same.indexOf(index), swapWith = same[pos + delta];
    if (swapWith === undefined) return;
    const next = [...items];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    setItems(next); touch();
  };
  const save = async () => {
    setBusy(true);
    try {
      await surveyAdminApi.saveStructure(workshopId, {
        groups: groups.map((g) => ({ id: g.id, key: g.key, title: g.title, short_title: g.short_title, tint: g.tint, parent_key: g.parent_key })),
        items: items.map((i) => ({ id: i.id, item_type: i.item_type, source_id: i.source_id, group_key: i.group_key, display_name: i.display_name })),
      });
      await onSaved("Đã lưu danh sách món — bấm “Xuất bản thay đổi” để áp dụng cho khách");
    } catch (e: any) { onError(e?.message || "Lưu thất bại"); } finally { setBusy(false); }
  };
  const uploadOverride = async (file?: File) => {
    if (!file || !uploadFor) return;
    if (dirty) { onError("Lưu danh sách món trước khi đổi ảnh riêng."); return; }
    setBusy(true);
    try { await surveyAdminApi.uploadItemImage(workshopId, uploadFor, file); await onSaved("Đã cập nhật ảnh riêng cho món trong khảo sát này"); }
    catch (e: any) { onError(e?.message || "Tải ảnh thất bại"); } finally { setBusy(false); setUploadFor(null); if (fileRef.current) fileRef.current.value = ""; }
  };

  const sections: { key: string | null; title: string; depth: number }[] = [
    ...tops.flatMap((t) => [{ key: t.key, title: t.title, depth: 0 }, ...childrenOf(t.key).map((c) => ({ key: c.key, title: `${t.title} › ${c.title}`, depth: 1 }))]),
    { key: null, title: "Khác (chưa xếp nhóm)", depth: 0 },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
      <div className="space-y-4">
        <section className="rounded-md border border-line bg-surface p-4 text-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-base font-bold text-brand-teal">Nhóm hiển thị (tab &amp; phân nhóm)</h2>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={buildFromCategories} disabled={!items.length} className="min-h-10 rounded-md border border-line px-3 disabled:opacity-40">Tạo nhóm theo danh mục</button>
                <button type="button" onClick={() => addGroup(null)} className="min-h-10 rounded-md border border-brand px-3 font-semibold text-brand-accent">+ Nhóm</button>
              </div>
            )}
          </div>
          {!tops.length && <p className="text-muted">Chưa có nhóm. Khách sẽ thấy mọi món trong một danh sách “Khác”.</p>}
          <ul className="space-y-2">
            {tops.map((t) => (
              <li key={t.key} className="rounded-md border border-line">
                <GroupRow group={t} canManage={canManage} onChange={(g) => { setGroups(groups.map((x) => (x.key === g.key ? g : x))); touch(); }}
                  onMove={(d) => moveGroup(t.key, d)} onRemove={() => removeGroup(t.key)} onAddChild={() => addGroup(t.key)} />
                {childrenOf(t.key).map((c) => (
                  <div key={c.key} className="border-t border-line pl-6">
                    <GroupRow group={c} canManage={canManage} onChange={(g) => { setGroups(groups.map((x) => (x.key === g.key ? g : x))); touch(); }}
                      onMove={(d) => moveGroup(c.key, d)} onRemove={() => removeGroup(c.key)} />
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-md border border-line bg-surface p-4 text-sm">
          <h2 className="mb-1 font-heading text-base font-bold text-brand-teal">Món trong khảo sát ({items.length})</h2>
          <p className="mb-3 text-muted">Thứ tự ở đây là thứ tự khách thấy. Tên riêng/ảnh riêng chỉ áp dụng cho khảo sát này, không đổi catalog.</p>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void uploadOverride(e.target.files?.[0])} />
          {sections.map((sec) => {
            const rows = items.map((it, index) => ({ it, index })).filter(({ it }) => (it.group_key || null) === sec.key);
            if (!rows.length && sec.key === null) return null;
            return (
              <div key={sec.key || "none"} className="mb-3">
                <h3 className={`mb-1 text-xs font-bold uppercase tracking-wide text-brand-accent ${sec.depth ? "pl-4" : ""}`}>{sec.title} · {rows.length}</h3>
                {!rows.length && <p className="pl-4 text-xs text-muted">Chưa có món.</p>}
                <ul className="divide-y divide-line rounded-md border border-line">
                  {rows.map(({ it, index }) => (
                    <li key={`${it.item_type}:${it.source_id}`} className="flex flex-wrap items-center gap-2 p-2">
                      {it.image_override_url || it.thumb_url ? <img src={it.image_override_url || it.thumb_url || ""} alt="" className="h-10 w-10 rounded object-cover" />
                        : <span className="grid h-10 w-10 place-items-center rounded bg-surface-muted text-[9px] text-muted">Chưa ảnh</span>}
                      <div className="min-w-[160px] flex-1">
                        <input value={it.display_name ?? ""} placeholder={it.catalog_name} disabled={!canManage} aria-label={`Tên hiển thị cho ${it.catalog_name}`}
                          onChange={(e) => { setItems(items.map((x, i) => (i === index ? { ...x, display_name: e.target.value || null } : x))); touch(); }}
                          className="min-h-9 w-full rounded border border-transparent px-1 font-semibold hover:border-line focus:border-line" />
                        <span className="px-1 text-xs text-muted">{it.item_type === "recipe" ? "Công thức" : "Sản phẩm"}{it.catalog_status && it.catalog_status !== "active" ? ` · ${it.catalog_status === "inactive" ? "đang tạm ẩn" : it.catalog_status === "archived" ? "đã lưu trữ — sẽ không hiển thị" : "không còn trong catalog"}` : ""}{it.image_override_url ? " · ảnh riêng" : ""}</span>
                      </div>
                      {canManage && (
                        <div className="flex flex-wrap items-center gap-1">
                          <select value={it.group_key || ""} aria-label="Chuyển nhóm" onChange={(e) => { setItems(items.map((x, i) => (i === index ? { ...x, group_key: e.target.value || null } : x))); touch(); }} className="min-h-9 max-w-[160px] rounded border border-line px-1 text-xs">
                            <option value="">Khác</option>
                            {sections.filter((s) => s.key).map((s) => <option key={s.key!} value={s.key!}>{s.title}</option>)}
                          </select>
                          <button type="button" aria-label="Lên" onClick={() => moveItem(index, -1)} className="min-h-9 min-w-9 rounded border border-line">↑</button>
                          <button type="button" aria-label="Xuống" onClick={() => moveItem(index, 1)} className="min-h-9 min-w-9 rounded border border-line">↓</button>
                          {it.id && <button type="button" onClick={() => { setUploadFor(it.id!); fileRef.current?.click(); }} className="min-h-9 rounded border border-line px-2 text-xs">Ảnh riêng</button>}
                          {it.id && it.image_override_url && <button type="button" onClick={async () => { try { await surveyAdminApi.deleteItemImage(workshopId, it.id!); await onSaved("Đã bỏ ảnh riêng"); } catch (e: any) { onError(e?.message); } }} className="min-h-9 px-1 text-xs text-muted">Bỏ ảnh riêng</button>}
                          <button type="button" aria-label={`Bỏ ${it.catalog_name} khỏi khảo sát`} onClick={() => { setItems(items.filter((_, i) => i !== index)); touch(); }} className="min-h-9 min-w-9 rounded text-error">×</button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      </div>

      <div className="space-y-3 xl:sticky xl:top-20 xl:self-start">
        {canManage && (
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy || !dirty} className="min-h-11 flex-1 rounded-md bg-brand px-4 text-sm font-semibold text-brand-teal disabled:opacity-50">{busy ? "Đang lưu…" : dirty ? "Lưu danh sách món" : "Đã lưu"}</button>
            {dirty && <button type="button" onClick={() => { setGroups(survey.groups); setItems(survey.items); setDirty(false); }} className="min-h-11 rounded-md border border-line px-3 text-sm">Huỷ</button>}
          </div>
        )}
        {canManage && (
          <section className="rounded-md border border-line bg-surface p-4 text-sm">
            <h2 className="mb-2 font-heading text-base font-bold text-brand-teal">Chọn từ catalog</h2>
            <label className="mb-2 block font-semibold">Thêm vào nhóm
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-line px-2 font-normal">
                <option value="">Khác (chưa xếp nhóm)</option>
                {sections.filter((s) => s.key).map((s) => <option key={s.key!} value={s.key!}>{s.title}</option>)}
              </select>
            </label>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm món…" aria-label="Tìm trong catalog" className="col-span-2 min-h-10 rounded-md border border-line px-3" />
              <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Loại" className="min-h-10 rounded-md border border-line px-2"><option value="">Tất cả loại</option><option value="product">Sản phẩm</option><option value="recipe">Công thức</option></select>
              <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} aria-label="Danh mục" className="min-h-10 rounded-md border border-line px-2">
                <option value="">Mọi danh mục</option>
                {categories.filter((c) => !c.parent_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <button type="button" onClick={addAllVisible} className="mb-2 min-h-9 text-brand-accent hover:underline">+ Thêm tất cả {visiblePool.filter((p) => !used.has(`${p.item_type}:${p.source_id}`)).length} món đang lọc</button>
            <ul className="max-h-[52vh] divide-y divide-line overflow-y-auto rounded-md border border-line">
              {visiblePool.map((p) => {
                const added = used.has(`${p.item_type}:${p.source_id}`);
                return (
                  <li key={`${p.item_type}:${p.source_id}`} className="flex items-center gap-2 p-2">
                    {p.thumb_url ? <img src={p.thumb_url} alt="" className="h-9 w-9 rounded object-cover" /> : <span className="h-9 w-9 rounded bg-surface-muted" />}
                    <div className="min-w-0 flex-1"><div className="truncate font-semibold">{p.name}</div><div className="text-xs text-muted">{p.item_type === "recipe" ? "Công thức" : "Sản phẩm"}{p.category_id ? ` · ${catName(p.category_id)}` : ""}</div></div>
                    <button type="button" disabled={added} onClick={() => addItem(p)} className="min-h-9 rounded-md border border-brand px-2 text-xs font-semibold text-brand-accent disabled:border-line disabled:text-muted">{added ? "Đã thêm" : "+ Thêm"}</button>
                  </li>
                );
              })}
              {!visiblePool.length && <li className="p-4 text-center text-muted">Không có món phù hợp. Thêm sản phẩm ở trang “Sản phẩm”.</li>}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function GroupRow({ group, canManage, onChange, onMove, onRemove, onAddChild }: {
  group: StructureGroup; canManage: boolean; onChange: (g: StructureGroup) => void; onMove: (d: number) => void; onRemove: () => void; onAddChild?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 p-2">
      {!group.parent_key && <span className="h-6 w-6 rounded border border-line" style={{ background: group.tint || "#f5f5f5" }} aria-hidden />}
      <input value={group.title} disabled={!canManage} onChange={(e) => onChange({ ...group, title: e.target.value })} aria-label="Tiêu đề nhóm (hiện ở đầu danh sách)" className="min-h-9 min-w-[160px] flex-1 rounded border border-line px-2 font-semibold" />
      <input value={group.short_title || ""} placeholder="Tên ngắn trên tab/chip" disabled={!canManage} onChange={(e) => onChange({ ...group, short_title: e.target.value || null })} aria-label="Tên ngắn" className="min-h-9 w-40 rounded border border-line px-2" />
      {canManage && (
        <>
          {!group.parent_key && (
            <select value={group.tint || ""} onChange={(e) => onChange({ ...group, tint: e.target.value || null })} aria-label="Màu nền ảnh" className="min-h-9 rounded border border-line px-1 text-xs">
              {TINTS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          )}
          <button type="button" aria-label="Lên" onClick={() => onMove(-1)} className="min-h-9 min-w-9 rounded border border-line">↑</button>
          <button type="button" aria-label="Xuống" onClick={() => onMove(1)} className="min-h-9 min-w-9 rounded border border-line">↓</button>
          {onAddChild && <button type="button" onClick={onAddChild} className="min-h-9 rounded border border-line px-2 text-xs">+ Phân nhóm</button>}
          <button type="button" onClick={onRemove} className="min-h-9 px-2 text-xs text-error">Xoá</button>
        </>
      )}
    </div>
  );
}
