"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtDateTime, fromLocalInput, surveyAdminApi, type SurveyResults } from "@/lib/survey-admin";

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <div className="text-xs font-semibold uppercase text-muted">{label}</div>
      <div className="mt-1 font-heading text-2xl font-extrabold text-brand-teal">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

function Bar({ value, max, label, right, color = "bg-brand" }: { value: number; max: number; label: string; right: string; color?: string }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <span className="truncate text-sm">{label}</span>
      <span className="text-xs font-semibold tabular-nums text-muted">{right}</span>
      <div className="col-span-2 h-2 overflow-hidden rounded-full bg-surface-muted" role="img" aria-label={`${label}: ${right}`}>
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function ResultsTab({ workshopId }: { workshopId: string }) {
  const [data, setData] = useState<SurveyResults | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rating, setRating] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [openItem, setOpenItem] = useState<string | null>(null);

  const params = useCallback(() => {
    const p: Record<string, string> = {};
    if (from) p.date_from = fromLocalInput(from)!;
    if (to) p.date_to = fromLocalInput(to)!;
    if (rating) p.rating = rating;
    return p;
  }, [from, to, rating]);
  const load = useCallback(async () => {
    try { setData(await surveyAdminApi.results(workshopId, params())); setError(null); } catch (e: any) { setError(e?.message || "Không tải được kết quả"); }
  }, [workshopId, params]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-error">{error}</div>;
  if (!data) return <div className="h-48 animate-pulse rounded-md bg-surface" />;
  const maxRating = Math.max(1, ...data.rating.distribution.map((d) => d.count));
  const pop = showAll ? data.popularity : data.popularity.slice(0, 15);
  const maxAdj = Math.max(1, ...data.adjectives.map((a) => a.count));

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-end gap-2 rounded-md border border-line bg-surface p-3">
        <label className="font-semibold">Từ<input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="ml-2 min-h-10 rounded-md border border-line px-2 font-normal" /></label>
        <label className="font-semibold">Đến<input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="ml-2 min-h-10 rounded-md border border-line px-2 font-normal" /></label>
        <label className="font-semibold">Số sao
          <select value={rating} onChange={(e) => setRating(e.target.value)} className="ml-2 min-h-10 rounded-md border border-line px-2 font-normal">
            <option value="">Tất cả</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} sao</option>)}
          </select>
        </label>
        <a href={surveyAdminApi.exportUrl(workshopId, params())} className="ml-auto flex min-h-10 items-center rounded-md border border-brand px-3 font-semibold text-brand-accent">Xuất Excel</a>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Phiếu hợp lệ" value={data.total_responses} sub={data.invalid_responses ? `${data.invalid_responses} phiếu đã loại` : undefined} />
        <Stat label="Đang làm dở" value={data.sessions.draft} sub="phiên chưa gửi" />
        <Stat label="Hài lòng TB" value={data.rating.average != null ? `${data.rating.average}/5` : "—"} sub={`${data.rating.count} lượt chấm`} />
        <Stat label="Quà đã phát" value={data.gifts.total} sub={`${data.gifts.issued} chưa nhận · ${data.gifts.expired} hết hạn`} />
        <Stat label="Quà đã trao" value={data.gifts.redeemed} sub={data.gifts.total ? `${Math.round((data.gifts.redeemed / data.gifts.total) * 100)}% số mã` : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="rounded-md border border-line bg-surface p-4">
          <h2 className="mb-1 font-heading text-base font-bold text-brand-teal">Món được yêu thích</h2>
          <p className="mb-3 text-xs text-muted">Tỷ lệ = số phiếu chọn món ÷ tổng phiếu hợp lệ ({data.total_responses}). Gộp theo sản phẩm/công thức gốc qua mọi phiên bản.</p>
          <div className="space-y-3">
            {pop.map((p) => (
              <div key={`${p.item_type}:${p.source_id}`}>
                <Bar value={p.favorites} max={Math.max(1, data.total_responses)} label={`${p.name}${p.group ? ` · ${p.group}` : ""}`}
                  right={`${p.favorites} lượt · ${(p.rate * 100).toFixed(1)}%${p.notes ? ` · ${p.notes} nhận xét` : ""}`} color="bg-[#dd2746]" />
                {p.notes > 0 && (
                  <button type="button" className="mt-1 text-xs text-brand-accent hover:underline" onClick={() => setOpenItem(openItem === p.source_id ? null : p.source_id)}>
                    {openItem === p.source_id ? "Ẩn nhận xét" : "Xem nhận xét"}
                  </button>
                )}
                {openItem === p.source_id && (
                  <div className="mt-1 rounded-md bg-surface-muted p-2 text-xs">
                    {p.tags.length > 0 && <div className="mb-1 flex flex-wrap gap-1">{p.tags.map((t) => <span key={t.tag} className="rounded-full bg-surface px-2 py-0.5">{t.tag} · {t.count}</span>)}</div>}
                    <ul className="list-disc space-y-1 pl-4">{p.note_samples.map((n, i) => <li key={i}>{n}</li>)}</ul>
                  </div>
                )}
              </div>
            ))}
            {!pop.length && <p className="text-muted">Chưa có dữ liệu.</p>}
          </div>
          {data.popularity.length > 15 && <button type="button" className="mt-3 min-h-9 text-brand-accent hover:underline" onClick={() => setShowAll(!showAll)}>{showAll ? "Thu gọn" : `Xem tất cả ${data.popularity.length} món`}</button>}
        </section>

        <div className="space-y-4">
          <section className="rounded-md border border-line bg-surface p-4">
            <h2 className="mb-3 font-heading text-base font-bold text-brand-teal">Phân bố mức hài lòng</h2>
            <div className="space-y-2">{[...data.rating.distribution].reverse().map((d) => <Bar key={d.rating} value={d.count} max={maxRating} label={`${d.rating} sao`} right={`${d.count}`} color="bg-[#f6b31f]" />)}</div>
          </section>
          <section className="rounded-md border border-line bg-surface p-4">
            <h2 className="mb-3 font-heading text-base font-bold text-brand-teal">Tính từ cảm nhận</h2>
            <div className="space-y-2">{data.adjectives.map((a) => <Bar key={a.label} value={a.count} max={maxAdj} label={a.label} right={`${a.count}`} />)}</div>
            {!data.adjectives.length && <p className="text-muted">Chưa có.</p>}
            {data.custom_adjectives.length > 0 && (
              <div className="mt-3 border-t border-line pt-2">
                <div className="mb-1 text-xs font-semibold uppercase text-muted">Khách tự viết</div>
                <div className="flex flex-wrap gap-1">{data.custom_adjectives.map((a) => <span key={a.label} className="rounded-full bg-surface-muted px-2 py-0.5 text-xs">{a.label} · {a.count}</span>)}</div>
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {([["Điều chưa thoải mái", data.discomfort], ["Kỳ vọng", data.expectation]] as const).map(([title, list]) => (
          <section key={title} className="rounded-md border border-line bg-surface p-4">
            <h2 className="mb-3 font-heading text-base font-bold text-brand-teal">{title} ({list.length})</h2>
            <ul className="max-h-96 space-y-2 overflow-y-auto">
              {list.map((f) => (
                <li key={f.response_id} className="rounded-md bg-surface-muted p-2">
                  <p className="whitespace-pre-line">{f.text}</p>
                  <span className="text-xs text-muted">{f.name} · {fmtDateTime(f.submitted_at)}</span>
                </li>
              ))}
              {!list.length && <li className="text-muted">Chưa có góp ý.</li>}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
