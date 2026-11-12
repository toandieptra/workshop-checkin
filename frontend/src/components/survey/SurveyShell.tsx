"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Bubble, Check, CheckCircle, Chevron, Close, Cup, Gallery as GalleryIcon, Heart, NoImage, Person, Search, SearchMinus, Star,
} from "./icons";
import { MASCOT } from "./Screens";
import { unaccent, type Draft, type PublicSurvey, type SurveyGroup, type SurveyItem } from "@/lib/survey-public";

export type Tab = "products" | "liked" | "feedback" | "finish";
export type SaveState = "idle" | "saving" | "saved" | "error";

type Props = {
  data: PublicSurvey;
  draft: Draft;
  update: (patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => void;
  saveState: SaveState;
  savedAt: string | null;
  name: string;
  phoneMasked: string;
  initialTab: Tab;
  readOnly?: boolean;
  submitting: boolean;
  submitError: string | null;
  onSubmit: () => void;
};

const TAB_LABEL: Record<Tab, string> = { products: "Sản phẩm", liked: "Đã thích", feedback: "Góp ý", finish: "Hoàn tất" };

function tagFor(item: SurveyItem, groups: Map<string, SurveyGroup>): string {
  const g = groups.get(item.group);
  if (!g) return "";
  const child = item.sub ? g.children.find((c) => c.key === item.sub) : null;
  return child ? `${g.short_title} · ${child.short_title}` : g.short_title;
}

function noteSummary(note?: { tags: string[]; text: string }): string {
  if (!note) return "";
  return [note.tags.join(" · "), note.text].filter(Boolean).join(" — ");
}

function vibrate() {
  try { navigator.vibrate?.(10); } catch { /* không hỗ trợ */ }
}

export default function SurveyShell(props: Props) {
  const { data, draft, update, saveState, savedAt, name, phoneMasked, readOnly, submitting, submitError, onSubmit } = props;
  const q = data.settings.questions;
  const tabs = useMemo<Tab[]>(() => {
    const list: Tab[] = [];
    if (q.favorites) list.push("products", "liked");
    if (!readOnly && (q.impressions || q.discomfort || q.expectation)) list.push("feedback");
    if (!readOnly) list.push("finish");
    return list;
  }, [q, readOnly]);
  const [tab, setTab] = useState<Tab>(tabs.includes(props.initialTab) ? props.initialTab : tabs[0]);
  const groupsByKey = useMemo(() => new Map(data.groups.map((g) => [g.key, g])), [data.groups]);
  const itemsByKey = useMemo(() => new Map(data.items.map((i) => [i.key, i])), [data.items]);
  const favSet = useMemo(() => new Set(draft.favorites), [draft.favorites]);
  const favItems = useMemo(() => draft.favorites.map((k) => itemsByKey.get(k)).filter(Boolean) as SurveyItem[], [draft.favorites, itemsByKey]);

  const [cat, setCat] = useState<string>(draft.ui.cat && (draft.ui.cat === "all" || groupsByKey.has(draft.ui.cat)) ? draft.ui.cat : "all");
  const [sub, setSub] = useState<string>(draft.ui.sub || "all");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [undo, setUndo] = useState<SurveyItem | null>(null);
  const [gallery, setGallery] = useState<{ key: string; i: number } | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [bumped, setBumped] = useState<string | null>(null);
  const [badgePop, setBadgePop] = useState(0);
  const [ratingErr, setRatingErr] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>();
  const paneRef = useRef<HTMLDivElement>(null);
  const scrollMemo = useRef<Record<string, number>>({});

  useEffect(() => { const t = setTimeout(() => setDebounced(query), 150); return () => clearTimeout(t); }, [query]);
  // Lưu tab/nhóm đang xem để mở lại đúng chỗ cũ.
  useEffect(() => {
    if (readOnly) return;
    if (draft.ui.tab !== tab || draft.ui.cat !== cat || draft.ui.sub !== sub) update({ ui: { tab, cat, sub } });
  }, [tab, cat, sub]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ẩn bottom nav khi bàn phím mở (thiết bị cảm ứng).
  useEffect(() => {
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    if (!coarse) return;
    const onIn = (e: FocusEvent) => { const t = e.target as HTMLElement; if (t.matches("input:not([type=checkbox]), textarea")) setKeyboard(true); };
    const onOut = () => setTimeout(() => {
      const a = document.activeElement as HTMLElement | null;
      setKeyboard(!!a && a.matches("input:not([type=checkbox]), textarea"));
    }, 50);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => { document.removeEventListener("focusin", onIn); document.removeEventListener("focusout", onOut); };
  }, []);

  // Gallery: nút back của trình duyệt đóng gallery.
  useEffect(() => {
    if (!gallery) return;
    const onPop = () => setGallery(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [gallery]);

  const openGallery = (item: SurveyItem) => {
    window.history.pushState({ lmGallery: true }, "");
    setGallery({ key: item.key, i: 0 });
  };
  const closeGallery = () => {
    if (window.history.state?.lmGallery) window.history.back();
    else setGallery(null);
  };

  const toggleFav = useCallback((item: SurveyItem, fromLiked = false) => {
    if (readOnly) return;
    const on = favSet.has(item.key);
    vibrate();
    setBumped(item.key);
    setTimeout(() => setBumped(null), 180);
    update((d) => ({ favorites: on ? d.favorites.filter((k) => k !== item.key) : [...d.favorites, item.key] }));
    if (on && fromLiked) {
      clearTimeout(undoTimer.current);
      setUndo(item);
      undoTimer.current = setTimeout(() => setUndo(null), 4000);
    } else if (!on) {
      setBadgePop((n) => n + 1);
      if (undo?.key === item.key) setUndo(null);
    }
  }, [favSet, readOnly, undo, update]);

  const goTab = (t: Tab) => {
    if (t === tab) paneRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setTab(t);
    setGallery(null);
  };

  // ---------- Products filtering ----------
  const qn = unaccent(debounced);
  const pool = useMemo(() => data.items.filter((p) =>
    (cat === "all" || p.group === cat) && (sub === "all" || cat === "all" || p.sub === sub)
    && (!qn || p.search.includes(qn))), [data.items, cat, sub, qn]);
  const activeGroup = cat !== "all" ? groupsByKey.get(cat) : undefined;
  const showSubs = !!activeGroup && activeGroup.children.length > 0 && !qn;

  const sections = useMemo(() => {
    if (qn) return pool.length ? [{ title: "Kết quả tìm kiếm", items: pool }] : [];
    const out: { title: string; items: SurveyItem[] }[] = [];
    const groupsToShow = cat === "all" ? data.groups : data.groups.filter((g) => g.key === cat);
    for (const g of groupsToShow) {
      const inGroup = pool.filter((p) => p.group === g.key);
      if (g.children.length) {
        const direct = inGroup.filter((p) => !p.sub);
        if (direct.length) out.push({ title: g.title, items: direct });
        for (const c of g.children) {
          const it = inGroup.filter((p) => p.sub === c.key);
          if (it.length) out.push({ title: (cat === "all" ? `${g.short_title} · ` : "") + c.title, items: it });
        }
      } else if (inGroup.length) {
        out.push({ title: g.title, items: inGroup });
      }
    }
    return out;
  }, [pool, qn, cat, data.groups]);

  const pickCat = (key: string) => {
    if (paneRef.current) scrollMemo.current[`${cat}|${sub}`] = paneRef.current.scrollTop;
    setCat(key);
    setSub("all");
    requestAnimationFrame(() => { if (paneRef.current) paneRef.current.scrollTop = scrollMemo.current[`${key}|all`] || 0; });
  };
  const pickSub = (key: string) => {
    if (paneRef.current) scrollMemo.current[`${cat}|${sub}`] = paneRef.current.scrollTop;
    setSub(key);
    requestAnimationFrame(() => { if (paneRef.current) paneRef.current.scrollTop = scrollMemo.current[`${cat}|${key}`] || 0; });
  };

  // ---------- Feedback ----------
  const pickedAdjs = [...draft.adjectives, ...draft.others.map((o) => o.trim()).filter(Boolean)];
  const trySubmit = () => {
    if (data.settings.rating_required && !draft.rating) {
      setRatingErr(true);
      paneRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      document.getElementById("lm-rating")?.focus();
      return;
    }
    onSubmit();
  };
  const sum = (t: string) => { const v = t.trim(); return v ? (v.length > 80 ? v.slice(0, 80) + "…" : v) : "Bỏ trống"; };
  const noteKeys = Object.keys(draft.notes).filter((k) => itemsByKey.has(k));

  // ---------- Card ----------
  const renderCard = (p: SurveyItem) => {
    const on = favSet.has(p.key);
    const g = groupsByKey.get(p.group);
    const img = p.images[0];
    const note = noteSummary(draft.notes[p.key]);
    return (
      <div key={p.key} className="lm-pcard" data-on={on}>
        <button type="button" className="lm-pimg" aria-label={`Xem ảnh ${p.name}`} onClick={() => openGallery(p)} style={{ background: g?.tint }}>
          {img ? <img src={img.thumb || img.src} alt="" loading="lazy" style={{ objectPosition: `center ${img.focus_y}%` }} />
            : <span className="lm-noimg"><NoImage />Ảnh đang cập nhật</span>}
          {p.images.length > 1 && <span className="lm-multi"><GalleryIcon />{p.images.length}</span>}
        </button>
        {!readOnly && (
          <button type="button" className={`lm-fav${bumped === p.key ? " lm-bump" : ""}`} aria-label={`Thích ${p.name}`} aria-pressed={on} onClick={() => toggleFav(p)}>
            <Heart fill={on ? "#ffffff" : "none"} color={on ? "#ffffff" : "#000000"} />
          </button>
        )}
        <div className="lm-pbody">
          <div className="lm-pbody-text">
            <span className="lm-clamp lm-pname">{p.name}</span>
            <span className="lm-ptag" data-on={on}>{on ? "Đã thích" : tagFor(p, groupsByKey)}</span>
            {note && <span className="lm-clamp lm-pnote">“{note}”</span>}
          </div>
          {q.product_notes && !readOnly && (
            <button type="button" className="lm-note-btn" data-has={!!note} aria-label={`Nhận xét về ${p.name}`} onClick={() => setNoteFor(p.key)}>
              <Bubble fill={note ? "#ffffff" : "none"} color={note ? "#005a9f" : "#4d4d4d"} />
            </button>
          )}
        </div>
      </div>
    );
  };

  const saveLabel = saveState === "saving" ? "Đang lưu nháp…" : saveState === "error" ? "! Chưa lưu được" : savedAt ? `Đã lưu · ${relTime(savedAt)}` : "Đã lưu nháp";

  return (
    <div className="lm-root">
      <div className="lm-app">
        {/* Top bar */}
        <div className="lm-topbar">
          <img className="lm-topbar-logo" src={MASCOT} alt="LerMao" />
          <div className="lm-topbar-text">
            <span style={{ fontSize: 14, lineHeight: "20px", fontWeight: 700 }}>Chào {name || "bạn"}</span>
            <span style={{ fontSize: 12, lineHeight: "16px", color: "var(--ink-secondary)" }}>{data.survey.title}</span>
          </div>
          {!readOnly ? (
            <span role="status" className="lm-save-pill" data-state={saveState}>
              {saveState === "saved" || saveState === "idle" ? <Check /> : null}{saveLabel}
            </span>
          ) : (
            <span className="lm-save-pill" data-state="saving">Chỉ xem</span>
          )}
        </div>

        <div className="lm-main">
          {/* ===== Products ===== */}
          {tab === "products" && (
            <>
              <div className="lm-products-head">
                {!collapsed && (
                  <div className="lm-pad lm-title-row">
                    <h2 className="lm-h2">Món anh/chị thích</h2>
                    <span className="lm-count">{draft.favorites.length}/{data.items.length} đã chọn</span>
                  </div>
                )}
                <div className="lm-pad">
                  <div className="lm-search">
                    <Search />
                    <input type="search" aria-label="Tìm món" placeholder="Tìm món… gõ không dấu cũng được" value={query}
                      onChange={(e) => setQuery(e.target.value)} enterKeyHint="search"
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                    {query && <button type="button" className="lm-search-clear" aria-label="Xoá tìm kiếm" onClick={() => setQuery("")}><Close /></button>}
                  </div>
                </div>
                {data.groups.length > 1 && (
                  <div className="lm-scroll lm-tabs" role="tablist" aria-label="Nhóm sản phẩm">
                    {[{ key: "all", label: "Tất cả", count: data.items.length }, ...data.groups.map((g) => ({ key: g.key, label: g.short_title, count: data.items.filter((i) => i.group === g.key).length }))].map((c) => (
                      <button key={c.key} type="button" role="tab" aria-selected={cat === c.key} className="lm-tab" onClick={() => pickCat(c.key)}>
                        {c.label} <span className="lm-tab-count">{c.count}</span>
                      </button>
                    ))}
                  </div>
                )}
                {showSubs && activeGroup && (
                  <div className="lm-scroll lm-chips" aria-label={`Phân nhóm ${activeGroup.short_title}`}>
                    {[{ key: "all", label: "Tất cả", count: data.items.filter((i) => i.group === activeGroup.key).length },
                      ...activeGroup.children.map((c) => ({ key: c.key, label: c.short_title, count: data.items.filter((i) => i.sub === c.key).length }))].map((s) => (
                      <button key={s.key} type="button" className="lm-chip" aria-pressed={sub === s.key} onClick={() => pickSub(s.key)}>{s.label} · {s.count}</button>
                    ))}
                  </div>
                )}
              </div>
              <div ref={paneRef} className="lm-pane lm-scroll" onScroll={(e) => setCollapsed((e.target as HTMLDivElement).scrollTop > 40)}>
                <div className="lm-grid-pane">
                  {qn && (
                    <p className="lm-search-info" role="status">
                      {pool.length} món khớp “{debounced.trim()}”{cat !== "all" ? ` trong ${activeGroup?.short_title}` : " trong tất cả nhóm"}
                    </p>
                  )}
                  {sections.map((s) => (
                    <section key={s.title}>
                      <div className="lm-group-head"><h3>{s.title}</h3><span>{s.items.length} món</span></div>
                      <div className="lm-grid">{s.items.map(renderCard)}</div>
                    </section>
                  ))}
                  {qn && pool.length === 0 && (
                    <div className="lm-empty">
                      <SearchMinus />
                      <h3>Chưa thấy món “{debounced.trim()}”</h3>
                      <p>{cat !== "all" ? <>Đang tìm trong <b style={{ color: "#000" }}>{activeGroup?.short_title}</b>. </> : null}Thử gõ ngắn hơn — hoặc tìm trong tất cả nhóm.</p>
                      <div className="lm-empty-actions">
                        {cat !== "all" && <button type="button" className="lm-btn-outline-link" onClick={() => pickCat("all")}>Tìm trong tất cả</button>}
                        <button type="button" className="lm-btn-soft" onClick={() => setQuery("")}>Xoá tìm kiếm</button>
                      </div>
                    </div>
                  )}
                  {!qn && data.items.length === 0 && (
                    <div className="lm-empty"><img src={MASCOT} alt="" width={96} height={96} /><h3>Danh sách món đang cập nhật</h3></div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ===== Liked ===== */}
          {tab === "liked" && (
            <div ref={paneRef} className="lm-pane lm-scroll">
              <div className="lm-liked">
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <h2 className="lm-h2">Đã thích <span style={{ color: "var(--crimson)" }}>{favItems.length}</span></h2>
                  {!readOnly && <span style={{ fontSize: 13, lineHeight: "20px", color: "var(--ink-secondary)" }}>Bỏ chọn bằng nút ✕ — có thể hoàn tác ngay.</span>}
                </div>
                {favItems.length > 0 ? (
                  <>
                    {data.groups.map((g) => {
                      const items = favItems.filter((p) => p.group === g.key);
                      if (!items.length) return null;
                      return (
                        <div key={g.key} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          <h3 className="lm-liked-group">{g.short_title} · {items.length}</h3>
                          {items.map((p) => {
                            const note = noteSummary(draft.notes[p.key]);
                            const img = p.images[0];
                            return (
                              <div key={p.key} className="lm-row">
                                <button type="button" className="lm-row-thumb" aria-label={`Xem ảnh ${p.name}`} onClick={() => openGallery(p)} style={{ background: g.tint }}>
                                  {img && <img src={img.thumb || img.src} alt="" style={{ objectPosition: `center ${img.focus_y}%` }} />}
                                </button>
                                <div className="lm-row-text">
                                  <span className="lm-clamp" style={{ fontSize: 15, lineHeight: "21px", fontWeight: 600 }}>{p.name}</span>
                                  <span style={{ fontSize: 12, lineHeight: "18px", color: "var(--ink-secondary)" }}>{tagFor(p, groupsByKey)}</span>
                                  {note ? <span className="lm-clamp" style={{ fontSize: 13, lineHeight: "18px", fontStyle: "italic", color: "var(--link)" }}>“{note}”</span>
                                    : q.product_notes && !readOnly ? <button type="button" onClick={() => setNoteFor(p.key)} style={{ alignSelf: "flex-start", minHeight: 32, padding: 0, border: 0, background: "transparent", color: "var(--link)", fontSize: 13, fontWeight: 700 }}>+ Thêm nhận xét</button> : null}
                                </div>
                                {q.product_notes && !readOnly && (
                                  <button type="button" className="lm-note-btn" data-has={!!note} aria-label={`Nhận xét về ${p.name}`} onClick={() => setNoteFor(p.key)}>
                                    <Bubble fill={note ? "#ffffff" : "none"} color={note ? "#005a9f" : "#4d4d4d"} />
                                  </button>
                                )}
                                {!readOnly && (
                                  <button type="button" className="lm-row-x" aria-label={`Bỏ thích ${p.name}`} onClick={() => toggleFav(p, true)}><Close /></button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                    {!readOnly && <button type="button" className="lm-add-more" onClick={() => goTab("products")}>+ Thử thêm món khác</button>}
                  </>
                ) : (
                  <div className="lm-empty" style={{ padding: "40px 12px" }}>
                    <img src={MASCOT} alt="" width={120} height={120} style={{ objectFit: "contain" }} />
                    <h3 style={{ fontSize: 20, lineHeight: "28px" }}>Chưa có món nào</h3>
                    <p>Thử món tại quầy, thấy ưng thì chạm tim trên thẻ món — món sẽ hiện ở đây.</p>
                    <button type="button" className="lm-btn lm-btn-primary" onClick={() => goTab("products")}>Khám phá {data.items.length} món</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== Feedback 02–04 ===== */}
          {tab === "feedback" && (
            <div ref={paneRef} className="lm-pane lm-scroll">
              <div className="lm-form">
                {q.impressions && (
                  <section className="lm-section">
                    <span className="lm-eyebrow">02 · Cảm nhận</span>
                    <h2 className="lm-q">{data.survey.impressions_title}</h2>
                    {data.survey.impressions_hint && <p className="lm-hint">{data.survey.impressions_hint}</p>}
                    <span role="status" className="lm-counter">
                      {pickedAdjs.length ? `Đã chọn ${pickedAdjs.length} tính từ · chọn bao nhiêu tùy ý` : "Chọn bao nhiêu tùy ý · không bắt buộc"}
                    </span>
                    <div className="lm-adj-grid">
                      {data.settings.adjectives.map((a) => {
                        const sel = draft.adjectives.includes(a);
                        return (
                          <button key={a} type="button" className="lm-adj" aria-pressed={sel}
                            onClick={() => update((d) => ({ adjectives: sel ? d.adjectives.filter((x) => x !== a) : [...d.adjectives, a] }))}>{a}</button>
                        );
                      })}
                    </div>
                    {draft.others.length > 0 && (
                      <div className="lm-other-grid">
                        {draft.others.map((v, i) => (
                          <input key={i} type="text" className="lm-other" data-filled={!!v.trim()} aria-label={`Tính từ khác ${i + 1}`} placeholder="Khác: …"
                            maxLength={40} value={v} onChange={(e) => update((d) => ({ others: d.others.map((o, j) => (j === i ? e.target.value : o)) }))} />
                        ))}
                      </div>
                    )}
                  </section>
                )}
                {q.discomfort && (
                  <section className="lm-section" style={{ gap: 8 }}>
                    <span className="lm-eyebrow">03 · Góp ý</span>
                    <label htmlFor="lm-fb1" className="lm-q-sm">{data.survey.discomfort_title}</label>
                    {data.survey.discomfort_hint && <p className="lm-hint">{data.survey.discomfort_hint}</p>}
                    <textarea id="lm-fb1" className="lm-textarea" rows={4} maxLength={1000} placeholder="VD: chỗ ngồi hơi chật, chờ món lâu…"
                      value={draft.discomfort} onChange={(e) => update({ discomfort: e.target.value })} />
                    <div className="lm-meta-row"><span>Không bắt buộc · sửa được tới khi gửi</span><span>{draft.discomfort.length}/1000</span></div>
                  </section>
                )}
                {q.expectation && (
                  <section className="lm-section" style={{ gap: 8 }}>
                    <span className="lm-eyebrow">04 · Kỳ vọng</span>
                    <label htmlFor="lm-fb2" className="lm-q-sm">{data.survey.expectation_title}</label>
                    <textarea id="lm-fb2" className="lm-textarea" rows={4} maxLength={1000}
                      placeholder="VD: thêm công thức pha chế gia đình, có phiên Q&A riêng, được thử nghiệm nguyên liệu mới, …"
                      value={draft.expectation} onChange={(e) => update({ expectation: e.target.value })} />
                    <div className="lm-meta-row"><span>Không bắt buộc · Có thể sửa đến khi gửi</span><span>{draft.expectation.length}/1000</span></div>
                  </section>
                )}
                <button type="button" className="lm-btn lm-btn-secondary" onClick={() => goTab("finish")}>Tiếp tục: Hoàn tất</button>
              </div>
            </div>
          )}

          {/* ===== Finish 05 ===== */}
          {tab === "finish" && (
            <div ref={paneRef} className="lm-pane lm-scroll">
              <div className="lm-form" style={{ gap: 20 }}>
                {q.rating && (
                  <section className="lm-section">
                    <span className="lm-eyebrow">05 · Hài lòng tổng thể</span>
                    <h2 className="lm-q">{data.survey.rating_title}</h2>
                    <div id="lm-rating" tabIndex={-1} role="radiogroup" aria-label="Mức độ hài lòng từ 1 đến 5" aria-describedby={ratingErr ? "lm-rating-err" : undefined} className="lm-stars">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} type="button" role="radio" aria-checked={draft.rating === n} aria-label={`${n} sao`} className="lm-star" data-fill={draft.rating >= n}
                          onClick={() => { update({ rating: n }); setRatingErr(false); }}>
                          <Star fill={draft.rating >= n ? "#f6b31f" : "none"} color={draft.rating >= n ? "#162d3c" : "#4d4d4d"} />
                          <span>{n}</span>
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ink-secondary)" }}><span>1 · Chưa hài lòng</span><span>5 · Rất hài lòng</span></div>
                    {ratingErr && <span id="lm-rating-err" role="alert" style={{ fontSize: 13, fontWeight: 600, color: "var(--danger)" }}>Chọn số sao giúp team trước khi gửi nhé.</span>}
                  </section>
                )}
                {q.favorites && (
                  <section className="lm-summary">
                    <div className="lm-summary-head">
                      <h3>Món đã thích · {favItems.length}</h3>
                      <button type="button" className="lm-btn-ghost" style={{ minHeight: 36 }} onClick={() => goTab("liked")}>Sửa</button>
                    </div>
                    {favItems.length ? (
                      <div className="lm-scroll lm-fav-strip">
                        {favItems.map((p) => (
                          <div key={p.key} className="lm-fav-mini">
                            <div style={{ background: groupsByKey.get(p.group)?.tint }}>{p.images[0] && <img src={p.images[0].thumb || p.images[0].src} alt="" style={{ objectPosition: `center ${p.images[0].focus_y}%` }} />}</div>
                            <span className="lm-clamp">{p.name}</span>
                          </div>
                        ))}
                      </div>
                    ) : <span style={{ fontSize: 14, color: "var(--ink-secondary)" }}>Chưa chọn món nào — vẫn có thể gửi.</span>}
                  </section>
                )}
                {(q.impressions || q.discomfort || q.expectation || q.product_notes) && (
                  <section className="lm-summary" style={{ gap: 8 }}>
                    <div className="lm-summary-head">
                      <h3>Cảm nhận &amp; góp ý</h3>
                      {tabs.includes("feedback") && <button type="button" className="lm-btn-ghost" style={{ minHeight: 36 }} onClick={() => goTab("feedback")}>Sửa</button>}
                    </div>
                    {q.impressions && <span className="lm-summary-line"><b>Tính từ:</b> {pickedAdjs.length ? pickedAdjs.join(", ") : "Bỏ trống"}</span>}
                    {q.discomfort && <span className="lm-summary-line"><b>Chưa thoải mái:</b> {sum(draft.discomfort)}</span>}
                    {q.expectation && <span className="lm-summary-line"><b>Mong đợi:</b> {sum(draft.expectation)}</span>}
                    {q.product_notes && <span className="lm-summary-line"><b>Nhận xét từng món:</b> {noteKeys.length ? `${noteKeys.length} món — ${noteKeys.map((k) => itemsByKey.get(k)?.name).join(", ")}` : "Chưa có"}</span>}
                  </section>
                )}
                <section className="lm-guestline">
                  <Person />
                  <span style={{ flex: "1 1 auto" }}><b>{name}</b> · {phoneMasked} <span style={{ color: "var(--ink-secondary)" }}>(không cần nhập lại)</span></span>
                </section>
                {submitError && (
                  <div role="alert" className="lm-error-banner"><Alert /><span style={{ flex: "1 1 auto" }}>{submitError}</span></div>
                )}
                <button type="button" className="lm-btn lm-btn-submit" onClick={trySubmit} disabled={submitting} aria-busy={submitting}>
                  {submitting ? "Đang gửi…" : submitError ? "Thử gửi lại" : "Gửi đánh giá"}
                </button>
                <p className="lm-fineprint">Sau khi gửi, phiếu được khoá. Có thể gửi bất kỳ lúc nào trước khi workshop kết thúc.</p>
              </div>
            </div>
          )}
        </div>

        {undo && (
          <div role="status" className="lm-snackbar">
            <span>Đã bỏ “{undo.name}”</span>
            <button type="button" onClick={() => { toggleFav(undo); setUndo(null); }}>Hoàn tác</button>
          </div>
        )}

        {tabs.length > 1 && (
          <nav aria-label="Điều hướng chính" className="lm-nav" hidden={keyboard} style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
            {tabs.map((t) => (
              <button key={t} type="button" className="lm-nav-btn" aria-current={tab === t ? "page" : undefined} onClick={() => goTab(t)}>
                <span className="lm-nav-bar" />
                <span className="lm-nav-icon">
                  {t === "products" && <Cup />}
                  {t === "liked" && <Heart size={24} color="currentColor" />}
                  {t === "feedback" && <Bubble size={24} color="currentColor" />}
                  {t === "finish" && <CheckCircle />}
                  {t === "liked" && favItems.length > 0 && <span key={badgePop} className={`lm-badge${badgePop ? " lm-pop" : ""}`}>{favItems.length}</span>}
                </span>
                <span>{TAB_LABEL[t]}</span>
              </button>
            ))}
          </nav>
        )}
      </div>

      {gallery && (() => {
        const p = itemsByKey.get(gallery.key);
        return p ? <GalleryOverlay item={p} index={gallery.i} tag={tagFor(p, groupsByKey)} on={favSet.has(p.key)} readOnly={readOnly}
          hasNote={!!draft.notes[p.key]} allowNotes={q.product_notes}
          onIndex={(i) => setGallery({ key: p.key, i })} onClose={closeGallery}
          onToggle={() => toggleFav(p)} onNote={() => setNoteFor(p.key)} /> : null;
      })()}

      {noteFor && itemsByKey.get(noteFor) && (
        <NoteSheet item={itemsByKey.get(noteFor)!} tag={tagFor(itemsByKey.get(noteFor)!, groupsByKey)} liked={favSet.has(noteFor)}
          tint={groupsByKey.get(itemsByKey.get(noteFor)!.group)?.tint} tags={data.settings.note_tags} initial={draft.notes[noteFor]}
          onClose={() => setNoteFor(null)}
          onSave={(note) => {
            update((d) => {
              const notes = { ...d.notes };
              if (note && (note.text.trim() || note.tags.length)) notes[noteFor] = { text: note.text.trim(), tags: note.tags };
              else delete notes[noteFor];
              return { notes };
            });
            setNoteFor(null);
          }} />
      )}
    </div>
  );
}

function relTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "vừa xong";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function useFocusTrap(ref: React.RefObject<HTMLElement>, onEscape: () => void) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>("button, textarea, input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onEscape(); return; }
      if (e.key !== "Tab" || !el) return;
      const nodes = Array.from(el.querySelectorAll<HTMLElement>("button:not([disabled]), textarea, input, [href]"));
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

function GalleryOverlay({ item, index, tag, on, readOnly, hasNote, allowNotes, onIndex, onClose, onToggle, onNote }: {
  item: SurveyItem; index: number; tag: string; on: boolean; readOnly?: boolean; hasNote: boolean; allowNotes: boolean;
  onIndex: (i: number) => void; onClose: () => void; onToggle: () => void; onNote: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const n = item.images.length;
  const i = n ? ((index % n) + n) % n : 0;
  const img = item.images[i];
  const touch = useRef<{ x: number; y: number } | null>(null);
  useFocusTrap(ref, onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && n > 1) onIndex(i + 1);
      if (e.key === "ArrowLeft" && n > 1) onIndex(i - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [i, n, onIndex]);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={`Ảnh ${item.name}`} className="lm-gallery">
      <div className="lm-gallery-head">
        <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 16, lineHeight: "22px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</span>
          <span style={{ fontSize: 12, lineHeight: "16px", opacity: 0.8 }}>{tag}</span>
        </div>
        <span className="lm-gallery-counter">{n ? `${i + 1} / ${n}` : "0 / 0"}</span>
        <button type="button" aria-label="Đóng" className="lm-round lm-round-dark" onClick={onClose}><Close size={20} color="#ffffff" /></button>
      </div>
      <div className="lm-gallery-stage"
        onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
        onTouchEnd={(e) => {
          const s = touch.current; touch.current = null;
          if (!s) return;
          const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && n > 1) onIndex(dx < 0 ? i + 1 : i - 1);
          else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) onClose();
        }}>
        {img ? <img src={img.src} alt={`${item.name} — ảnh ${i + 1} / ${n}`} />
          : <span style={{ fontSize: 14, opacity: 0.8 }}>Ảnh sản phẩm đang cập nhật</span>}
        {n > 1 && (
          <>
            <button type="button" aria-label="Ảnh trước" className="lm-round lm-round-light lm-gallery-prev" onClick={() => onIndex(i - 1)}><Chevron dir="left" /></button>
            <button type="button" aria-label="Ảnh sau" className="lm-round lm-round-light lm-gallery-next" onClick={() => onIndex(i + 1)}><Chevron dir="right" /></button>
          </>
        )}
      </div>
      {n > 1 && <div className="lm-dots">{item.images.map((_, k) => <span key={k} className="lm-dot" data-on={k === i} />)}</div>}
      <div className="lm-gallery-foot">
        {!readOnly && (
          <button type="button" className="lm-gal-fav" aria-pressed={on} onClick={onToggle}>
            <Heart fill={on ? "#ffffff" : "none"} color={on ? "#ffffff" : "#000000"} />{on ? "Đã thích món này" : "Thích món này"}
          </button>
        )}
        {allowNotes && !readOnly && (
          <button type="button" className="lm-gal-note" onClick={onNote}><Bubble color="#ffffff" />{hasNote ? "Sửa nhận xét về món" : "Viết nhận xét về món"}</button>
        )}
        <span style={{ textAlign: "center", fontSize: 12, opacity: 0.8 }}>Vuốt ngang để xem ảnh khác · Vuốt xuống để đóng</span>
      </div>
    </div>
  );
}

function NoteSheet({ item, tag, liked, tint, tags, initial, onClose, onSave }: {
  item: SurveyItem; tag: string; liked: boolean; tint?: string; tags: string[];
  initial?: { tags: string[]; text: string }; onClose: () => void; onSave: (note: { tags: string[]; text: string } | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(initial?.text || "");
  const [picked, setPicked] = useState<string[]>(initial?.tags || []);
  useFocusTrap(ref, onClose);
  const img = item.images[0];
  return (
    <div className="lm-sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="lm-note-title" className="lm-sheet">
        <span aria-hidden="true" className="lm-grabber" />
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="lm-note-thumb" style={{ background: tint }}>{img && <img src={img.thumb || img.src} alt="" style={{ objectPosition: `center ${img.focus_y}%` }} />}</span>
          <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span id="lm-note-title" className="lm-eyebrow">Nhận xét về món</span>
            <b className="lm-clamp" style={{ fontSize: 16, lineHeight: "22px" }}>{item.name}</b>
            <span style={{ fontSize: 12, color: "var(--ink-secondary)" }}>{tag}{liked ? " · Đã thích" : ""}</span>
          </div>
          <button type="button" aria-label="Đóng" className="lm-round" style={{ background: "var(--surface)" }} onClick={onClose}><Close /></button>
        </div>
        {tags.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Gợi ý nhanh <span style={{ fontWeight: 500, color: "var(--ink-secondary)" }}>· chạm để chọn nhiều</span></span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {tags.map((t) => {
                const on = picked.includes(t);
                return <button key={t} type="button" className="lm-tag-btn" aria-pressed={on} onClick={() => setPicked(on ? picked.filter((x) => x !== t) : [...picked, t])}>{t}</button>;
              })}
            </div>
          </div>
        )}
        <label htmlFor="lm-note" style={{ fontSize: 13, fontWeight: 700 }}>Cảm nhận của anh/chị</label>
        <textarea id="lm-note" rows={3} maxLength={300} className="lm-textarea" style={{ minHeight: 96, resize: "none" }}
          placeholder="Vị, độ ngọt, kết cấu, ý tưởng phối món…" value={text} onChange={(e) => setText(e.target.value.slice(0, 300))} />
        <div className="lm-meta-row"><span>Không bắt buộc · không tự thêm vào “Đã thích”</span><span>{text.length}/300</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
          <button type="button" className="lm-btn lm-btn-secondary" style={{ fontSize: 15, padding: 0 }} onClick={() => (initial ? onSave(null) : onClose())}>{initial ? "Xoá nhận xét" : "Huỷ"}</button>
          <button type="button" className="lm-btn lm-btn-primary" onClick={() => onSave({ text, tags: picked })}>Lưu nhận xét</button>
        </div>
      </div>
    </div>
  );
}
