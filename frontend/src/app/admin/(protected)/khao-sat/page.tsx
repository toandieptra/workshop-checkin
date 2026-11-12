"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";
import { fmtDateTime, surveyAdminApi, type SurveyEnvelope } from "@/lib/survey-admin";
import SurveyConfigTab from "@/components/survey-admin/SurveyConfigTab";
import StructureTab from "@/components/survey-admin/StructureTab";
import GiftTab from "@/components/survey-admin/GiftTab";
import QrTab from "@/components/survey-admin/QrTab";
import ResultsTab from "@/components/survey-admin/ResultsTab";
import ResponsesTab from "@/components/survey-admin/ResponsesTab";

type WorkshopLite = { id: string; name: string; event_date?: string | null };
type TabKey = "config" | "items" | "gift" | "qr" | "results" | "responses";
const TABS: { key: TabKey; label: string }[] = [
  { key: "config", label: "Cấu hình" }, { key: "items", label: "Món & nhóm" }, { key: "gift", label: "Quà tặng" },
  { key: "qr", label: "Link & QR" }, { key: "results", label: "Kết quả" }, { key: "responses", label: "Phiếu trả lời" },
];
const STATE_BADGE: Record<string, { label: string; cls: string }> = {
  draft: { label: "Bản nháp", cls: "bg-surface-muted text-muted border-line" },
  open: { label: "Đang mở nhận phiếu", cls: "bg-success-soft text-success border-success-border" },
  not_open: { label: "Đã xuất bản · chưa tới giờ mở", cls: "bg-amber-50 text-warning border-amber-200" },
  closed: { label: "Đã đóng", cls: "bg-red-50 text-error border-red-200" },
};

export default function SurveyAdminPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { canForWorkshop } = useAuth();
  const [workshops, setWorkshops] = useState<WorkshopLite[]>([]);
  const [workshopId, setWorkshopId] = useState<string>(params.get("workshop") || "");
  const [tab, setTab] = useState<TabKey>((params.get("tab") as TabKey) || "config");
  const [env, setEnv] = useState<SurveyEnvelope | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    api<WorkshopLite[]>("/workshops?permission=surveys.read").then((ws) => {
      setWorkshops(ws);
      if (!workshopId && ws.length) setWorkshopId(ws[0].id);
    }).catch((e) => setMsg({ tone: "err", text: e?.message || "Không tải được workshop" }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!workshopId) return;
    const q = new URLSearchParams(params.toString());
    q.set("workshop", workshopId);
    q.set("tab", tab);
    router.replace(`${pathname}?${q}`, { scroll: false });
  }, [workshopId, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(async () => {
    if (!workshopId) return;
    setLoading(true);
    try { setEnv(await surveyAdminApi.get(workshopId)); } catch (e: any) { setMsg({ tone: "err", text: e?.message || "Không tải được khảo sát" }); setEnv(null); }
    finally { setLoading(false); }
  }, [workshopId]);
  useEffect(() => { setEnv(null); void reload(); }, [reload]);

  const canManage = !!workshopId && canForWorkshop(PERMISSIONS.surveysManage, workshopId);
  const canGift = !!workshopId && canForWorkshop(PERMISSIONS.giftsManage, workshopId);
  const survey = env?.survey || null;
  const unpublished = !!survey && !!survey.published_at && !!survey.updated_at && new Date(survey.updated_at) > new Date(survey.published_at);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); await reload(); setMsg({ tone: "ok", text: ok }); } catch (e: any) { setMsg({ tone: "err", text: e?.message || "Thao tác thất bại" }); }
    finally { setBusy(false); }
  };

  return (
    <div className="px-3 py-3 pb-20 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-teal">Khảo sát workshop</h1>
          <p className="mt-1 text-sm text-muted">Cấu hình phiếu khảo sát công khai, quà tặng và xem kết quả theo từng workshop.</p>
        </div>
        <label className="flex flex-col text-sm font-semibold text-brand-teal lg:w-96">Workshop
          <select value={workshopId} onChange={(e) => setWorkshopId(e.target.value)} className="mt-1 min-h-11 rounded-md border border-line bg-surface px-3 font-normal">
            {!workshops.length && <option value="">Không có workshop được cấp quyền</option>}
            {workshops.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
      </div>

      {msg && (
        <div role={msg.tone === "ok" ? "status" : "alert"} className={`mb-3 rounded-md border px-4 py-2 text-sm ${msg.tone === "ok" ? "border-success-border bg-success-soft text-success" : "border-red-200 bg-red-50 text-error"}`}>
          {msg.text} <button type="button" className="ml-2 underline" onClick={() => setMsg(null)}>Đóng</button>
        </div>
      )}

      {survey && (
        <div className="mb-3 flex flex-col gap-3 rounded-md border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATE_BADGE[survey.public_state]?.cls}`}>{STATE_BADGE[survey.public_state]?.label}</span>
            {survey.versions[0] && <span className="text-muted">Phiên bản {survey.versions[0].version_no} · xuất bản {fmtDateTime(survey.versions[0].published_at)}</span>}
            {unpublished && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-warning">Có thay đổi chưa xuất bản</span>}
            <span className="text-muted">· {survey.session_counts.submitted} phiếu đã gửi · {survey.session_counts.draft} đang làm</span>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {survey.status !== "closed" && (
                <button type="button" disabled={busy} onClick={() => act(() => surveyAdminApi.publish(workshopId), "Đã xuất bản phiên bản mới")}
                  className="min-h-11 rounded-md bg-brand px-4 text-sm font-semibold text-brand-teal disabled:opacity-60">
                  {survey.current_version_id ? "Xuất bản thay đổi" : "Xuất bản"}
                </button>
              )}
              {survey.status === "published" && (
                <button type="button" disabled={busy} onClick={() => { if (window.confirm("Đóng nhận phiếu? Khách đang làm sẽ không gửi được nữa.")) void act(() => surveyAdminApi.close(workshopId), "Đã đóng khảo sát"); }}
                  className="min-h-11 rounded-md border border-red-200 px-4 text-sm font-semibold text-error">Đóng nhận phiếu</button>
              )}
              {survey.status === "closed" && (
                <button type="button" disabled={busy} onClick={() => act(() => surveyAdminApi.reopen(workshopId), "Đã mở lại khảo sát")}
                  className="min-h-11 rounded-md border border-brand px-4 text-sm font-semibold text-brand-accent">Mở lại</button>
              )}
            </div>
          )}
        </div>
      )}

      {workshopId && (
        <div role="tablist" aria-label="Phần cấu hình khảo sát" className="mb-3 flex gap-1 overflow-x-auto border-b border-line">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} disabled={!survey && t.key !== "config"}
              className={`-mb-px min-h-11 whitespace-nowrap border-b-2 px-4 text-sm font-semibold disabled:opacity-40 ${tab === t.key ? "border-brand text-brand-teal" : "border-transparent text-muted hover:text-brand-teal"}`}>{t.label}</button>
          ))}
        </div>
      )}

      {loading && !env && <div className="h-40 animate-pulse rounded-md bg-surface" />}
      {env && workshopId && (
        <>
          {tab === "config" && <SurveyConfigTab workshopId={workshopId} env={env} canManage={canManage} onSaved={async (text) => { await reload(); setMsg({ tone: "ok", text }); }} onError={(text) => setMsg({ tone: "err", text })} />}
          {tab === "items" && survey && <StructureTab workshopId={workshopId} survey={survey} canManage={canManage} onSaved={async (text) => { await reload(); setMsg({ tone: "ok", text }); }} onError={(text) => setMsg({ tone: "err", text })} />}
          {tab === "gift" && survey && <GiftTab workshopId={workshopId} config={env.gift_config} canManage={canGift} onSaved={async (text) => { await reload(); setMsg({ tone: "ok", text }); }} onError={(text) => setMsg({ tone: "err", text })} />}
          {tab === "qr" && survey && <QrTab survey={survey} />}
          {tab === "results" && survey && <ResultsTab workshopId={workshopId} />}
          {tab === "responses" && survey && <ResponsesTab workshopId={workshopId} canManage={canManage} />}
        </>
      )}
    </div>
  );
}
