"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { fmtDateTime, GIFT_STATUS_LABEL, surveyAdminApi, type ResponseDetail, type ResponseRow } from "@/lib/survey-admin";

export default function ResponsesTab({ workshopId, canManage }: { workshopId: string; canManage: boolean }) {
  const [rows, setRows] = useState<ResponseRow[] | null>(null);
  const [q, setQ] = useState("");
  const [rating, setRating] = useState("");
  const [gift, setGift] = useState("any");
  const [includeInvalid, setIncludeInvalid] = useState(false);
  const [detail, setDetail] = useState<ResponseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = useCallback(() => {
    const p: Record<string, string> = { gift };
    if (q.trim()) p.q = q.trim();
    if (rating) p.rating = rating;
    if (includeInvalid) p.include_invalid = "true";
    return p;
  }, [q, rating, gift, includeInvalid]);
  const load = useCallback(async () => {
    try { setRows(await surveyAdminApi.responses(workshopId, params())); setError(null); } catch (e: any) { setError(e?.message || "Không tải được phiếu"); }
  }, [workshopId, params]);
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);

  const open = async (id: string) => {
    try { setDetail(await surveyAdminApi.response(workshopId, id)); } catch (e: any) { setError(e?.message || "Không mở được phiếu"); }
  };
  const toggleValid = async (r: ResponseDetail) => {
    const next = !r.is_valid;
    if (!next && !window.confirm("Loại phiếu này khỏi thống kê? (Không xoá dữ liệu, có thể khôi phục)")) return;
    try { await surveyAdminApi.setValid(workshopId, r.id, next); setDetail({ ...r, is_valid: next }); await load(); } catch (e: any) { setError(e?.message || "Không cập nhật được"); }
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface p-3">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên hoặc 3+ số cuối SĐT" aria-label="Tìm phiếu" className="min-h-10 min-w-[220px] flex-1 rounded-md border border-line px-3" />
        <select value={rating} onChange={(e) => setRating(e.target.value)} aria-label="Lọc số sao" className="min-h-10 rounded-md border border-line px-2">
          <option value="">Mọi mức sao</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} sao</option>)}
        </select>
        <select value={gift} onChange={(e) => setGift(e.target.value)} aria-label="Lọc quà" className="min-h-10 rounded-md border border-line px-2">
          <option value="any">Mọi trạng thái quà</option><option value="issued">Chưa nhận quà</option><option value="redeemed">Đã nhận quà</option><option value="none">Không có quà</option>
        </select>
        <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={includeInvalid} onChange={(e) => setIncludeInvalid(e.target.checked)} />Gồm phiếu đã loại</label>
        <a href={surveyAdminApi.exportUrl(workshopId, includeInvalid ? { include_invalid: "true" } : {})} className="flex min-h-10 items-center rounded-md border border-brand px-3 font-semibold text-brand-accent">Xuất Excel</a>
      </div>
      {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-error">{error}</div>}
      <div className="admin-table-scroll overflow-x-auto rounded-md border border-line bg-surface">
        <table className="w-full min-w-[760px]">
          <thead className="bg-surface-muted text-left text-xs uppercase text-muted">
            <tr><th className="px-3 py-2">Gửi lúc</th><th className="px-3 py-2">Khách</th><th className="px-3 py-2">Đăng ký</th><th className="px-3 py-2 text-right">Sao</th><th className="px-3 py-2 text-right">Món thích</th><th className="px-3 py-2">Tính từ</th><th className="px-3 py-2">Quà</th></tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={7} className="p-4"><div className="h-10 animate-pulse rounded bg-surface-muted" /></td></tr>}
            {rows?.map((r) => (
              <tr key={r.id} onClick={() => void open(r.id)} className={`cursor-pointer border-t border-line hover:bg-surface-muted/60 ${r.is_valid ? "" : "opacity-50"}`}>
                <td className="px-3 py-2 text-muted">{fmtDateTime(r.submitted_at)}</td>
                <td className="px-3 py-2"><button type="button" className="text-left font-semibold text-brand-teal hover:underline" onClick={(e) => { e.stopPropagation(); void open(r.id); }}>{r.full_name}</button><div className="text-xs text-muted">{r.phone_masked}{r.has_feedback ? " · có góp ý" : ""}{!r.is_valid ? " · đã loại" : ""}</div></td>
                <td className="px-3 py-2">{r.registered ? "Có" : <span className="text-muted">Không khớp</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.rating ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.favorite_count}</td>
                <td className="max-w-[240px] truncate px-3 py-2 text-muted">{r.adjectives.join(", ") || "—"}</td>
                <td className="px-3 py-2">{r.gift_status ? GIFT_STATUS_LABEL[r.gift_status] || r.gift_status : "—"}</td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan={7} className="px-3 py-10 text-center text-muted">Chưa có phiếu phù hợp.</td></tr>}
          </tbody>
        </table>
      </div>
      {detail && <ResponseDialog detail={detail} canManage={canManage} onClose={() => setDetail(null)} onToggleValid={() => void toggleValid(detail)} />}
    </div>
  );
}

function ResponseDialog({ detail, canManage, onClose, onToggleValid }: { detail: ResponseDetail; canManage: boolean; onClose: () => void; onToggleValid: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(true, ref);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const favs = detail.items.filter((i) => i.favorited);
  const notes = detail.items.filter((i) => i.note_text || i.note_tags.length);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="resp-title" className="flex h-full w-full max-w-lg flex-col bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <h2 id="resp-title" className="font-heading text-lg font-bold text-brand-teal">{detail.full_name}</h2>
            <div className="text-xs text-muted">{detail.phone_masked} · {fmtDateTime(detail.submitted_at)} · phiên bản {detail.version_no}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="min-h-11 min-w-11 text-xl text-muted">×</button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-surface-muted px-2 py-0.5">{detail.rating ? `${detail.rating}/5 sao` : "Không chấm sao"}</span>
            <span className="rounded-full bg-surface-muted px-2 py-0.5">{detail.registered ? "Khớp đăng ký workshop" : "Không khớp đăng ký"}</span>
            {detail.gift && <span className="rounded-full bg-surface-muted px-2 py-0.5">Quà: {GIFT_STATUS_LABEL[detail.gift.status] || detail.gift.status}</span>}
            {!detail.is_valid && <span className="rounded-full bg-red-50 px-2 py-0.5 text-error">Đã loại khỏi thống kê</span>}
          </div>
          <section><h3 className="mb-1 font-semibold">Món đã thích ({favs.length})</h3>
            <ul className="list-disc pl-5">{favs.map((i) => <li key={i.name}>{i.name}{i.group ? <span className="text-muted"> · {i.group}</span> : null}</li>)}</ul>
            {!favs.length && <p className="text-muted">Không chọn món nào.</p>}
          </section>
          {notes.length > 0 && (
            <section><h3 className="mb-1 font-semibold">Nhận xét từng món</h3>
              <ul className="space-y-2">{notes.map((i) => <li key={i.name} className="rounded-md bg-surface-muted p-2"><b>{i.name}</b>{i.note_tags.length > 0 && <div className="text-xs">{i.note_tags.join(" · ")}</div>}{i.note_text && <p>{i.note_text}</p>}</li>)}</ul>
            </section>
          )}
          <section><h3 className="mb-1 font-semibold">Tính từ</h3><p>{[...detail.adjectives, ...detail.custom_adjectives].join(", ") || "—"}</p></section>
          <section><h3 className="mb-1 font-semibold">Chưa thoải mái</h3><p className="whitespace-pre-line">{detail.discomfort || "—"}</p></section>
          <section><h3 className="mb-1 font-semibold">Mong đợi</h3><p className="whitespace-pre-line">{detail.expectation || "—"}</p></section>
        </div>
        {canManage && (
          <div className="border-t border-line px-5 py-3">
            <button type="button" onClick={onToggleValid} className={`min-h-11 rounded-md border px-4 font-semibold ${detail.is_valid ? "border-red-200 text-error" : "border-brand text-brand-accent"}`}>
              {detail.is_valid ? "Loại khỏi thống kê" : "Khôi phục vào thống kê"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
