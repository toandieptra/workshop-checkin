"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import SurveyShell, { type SaveState, type Tab } from "@/components/survey/SurveyShell";
import { ClosedScreen, IdentifyScreen, InvalidScreen, LoadingScreen, ResumeScreen, ThanksScreen } from "@/components/survey/Screens";
import {
  clearLocal, normalizeDraft, readLocal, surveyApi, SurveyApiError, writeLocal,
  type Draft, type PublicSurvey, type SessionState, type Submission,
} from "@/lib/survey-public";

export const dynamic = "force-dynamic";

type Screen = "loading" | "invalid" | "error" | "closed" | "not_open" | "identify" | "resume" | "app" | "liked_readonly" | "thanks";

const ERRORS: Record<string, string> = {
  already_submitted: "Số điện thoại này đã gửi phiếu cho workshop. Nếu cần hỗ trợ, vui lòng liên hệ ban tổ chức tại quầy.",
  not_checked_in: "Số điện thoại này chưa check-in tại workshop. Anh/chị vui lòng liên hệ nhân viên LerMao tại quầy để check-in, sau đó quay lại trang này để làm khảo sát nhé.",
  quota_reached: "Số điện thoại này đã gửi đủ số phiếu bằng số khách đã check-in. Nếu anh/chị đi cùng thêm người, vui lòng liên hệ nhân viên tại quầy để cập nhật số khách check-in.",
  "429": "Anh/chị thao tác hơi nhanh — vui lòng thử lại sau ít phút.",
};

export default function SurveyPage() {
  const { slug: rawSlug } = useParams<{ slug: string }>();
  const slug = (rawSlug || "").toLowerCase();
  const [screen, setScreen] = useState<Screen>("loading");
  const [data, setData] = useState<PublicSurvey | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [localGift, setLocalGift] = useState<{ qr: string; code: string } | null>(null);
  const [reissuing, setReissuing] = useState(false);
  const [reissueError, setReissueError] = useState<string | null>(null);
  const [initialTab, setInitialTab] = useState<Tab>("products");
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const pending = useRef<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;

  // ---------- Initial load ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let survey: PublicSurvey;
      try {
        survey = await surveyApi.get(slug);
      } catch (e) {
        if (!cancelled) setScreen(e instanceof SurveyApiError && e.status === 404 ? "invalid" : "error");
        return;
      }
      if (cancelled) return;
      setData(survey);
      const local = readLocal(slug);
      setLocalGift(local.gift || null);
      if (local.token) {
        try {
          const s = await surveyApi.session(slug, local.token);
          if (cancelled) return;
          setToken(local.token);
          setSession(s);
          const d = normalizeDraft(s.draft, survey.settings.custom_adjective_slots);
          setDraft(d);
          setSavedAt(s.updated_at);
          if (s.status === "submitted" && s.submission) {
            setSubmission(s.submission);
            setScreen("thanks");
            return;
          }
          setInitialTab((d.ui.tab as Tab) || "products");
          if (survey.state === "closed") { setScreen("closed"); return; }
          if (survey.state === "not_open") { setScreen("not_open"); return; }
          setScreen("resume");
          return;
        } catch (e) {
          if (e instanceof SurveyApiError && e.status === 401) {
            // Phiên không còn (đã xoá / survey khác): bắt đầu lại, giữ nháp cục bộ để không mất dữ liệu đang hiển thị.
            writeLocal(slug, { token: undefined });
          } else if (!cancelled) {
            setScreen("error");
            return;
          }
        }
      }
      if (cancelled) return;
      setScreen(survey.state === "closed" ? "closed" : survey.state === "not_open" ? "not_open" : "identify");
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // ---------- Autosave (debounce 400ms). Chỉ báo “Đã lưu” khi máy chủ xác nhận. ----------
  const flush = useCallback(async () => {
    const d = pending.current;
    if (!d || !token) return;
    pending.current = null;
    setSaveState("saving");
    try {
      const res = await surveyApi.save(slug, token, d);
      setSavedAt(res.saved_at);
      setSaveState(pending.current ? "saving" : "saved");
      writeLocal(slug, { savedAt: res.saved_at });
    } catch (e) {
      if (e instanceof SurveyApiError && e.code === "closed") { setScreen("closed"); return; }
      if (e instanceof SurveyApiError && e.code === "already_submitted") { window.location.reload(); return; }
      pending.current = pending.current || d;
      setSaveState("error");
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { void flush(); }, 5000);
    }
  }, [slug, token]);

  const update = useCallback((patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...(typeof patch === "function" ? patch(prev) : patch) };
      pending.current = next;
      writeLocal(slug, { draft: next });
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { void flush(); }, 400);
      setSaveState("saving");
      return next;
    });
  }, [flush, slug]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden" && pending.current) { clearTimeout(saveTimer.current); void flush(); } };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => { document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", onHide); };
  }, [flush]);

  // ---------- Identify ----------
  const start = async (name: string, phone: string) => {
    if (!data) return;
    setStartBusy(true);
    setStartError(null);
    try {
      const res = await surveyApi.start(slug, name, phone);
      setToken(res.token);
      setSession(res.session);
      const d = normalizeDraft(undefined, data.settings.custom_adjective_slots);
      setDraft(d);
      writeLocal(slug, { token: res.token, name, draft: d, gift: null });
      setLocalGift(null);
      setSaveState("saved");
      setInitialTab("products");
      setScreen("app");
    } catch (e) {
      if (e instanceof SurveyApiError) {
        if (e.code === "closed") { setScreen("closed"); return; }
        if (e.code === "not_open") { setScreen("not_open"); return; }
        setStartError(ERRORS[e.code] || (e.status === 422 ? e.code : "Chưa mở được phiếu — vui lòng thử lại."));
      } else {
        setStartError("Không kết nối được máy chủ — kiểm tra mạng rồi thử lại.");
      }
    } finally {
      setStartBusy(false);
    }
  };

  const resetSession = async () => {
    if (token) { try { await surveyApi.discard(slug, token); } catch { /* vẫn xoá cục bộ */ } }
    clearLocal(slug);
    setToken(null); setSession(null); setDraft(null); setLocalGift(null);
    setScreen("identify");
  };

  // ---------- Submit ----------
  const submit = async () => {
    if (!token || !draftRef.current) return;
    clearTimeout(saveTimer.current);
    pending.current = null;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await surveyApi.submit(slug, token, draftRef.current);
      const g = res.submission.gift;
      if (g.qr && g.code) { writeLocal(slug, { gift: { qr: g.qr, code: g.code } }); setLocalGift({ qr: g.qr, code: g.code }); }
      setSubmission(res.submission);
      setScreen("thanks");
      window.scrollTo(0, 0);
    } catch (e) {
      if (e instanceof SurveyApiError && e.code === "closed") { setScreen("closed"); return; }
      if (e instanceof SurveyApiError && ERRORS[e.code]) {
        setSubmitError(ERRORS[e.code]);
      } else if (e instanceof SurveyApiError && e.code === "rating_required") {
        setSubmitError("Chọn số sao giúp team trước khi gửi nhé.");
      } else {
        setSubmitError("Chưa gửi được — kiểm tra kết nối rồi thử lại. Lựa chọn của anh/chị vẫn được giữ nguyên.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const reissue = async () => {
    if (!token) return;
    setReissuing(true);
    setReissueError(null);
    try {
      const res = await surveyApi.reissue(slug, token);
      if (res.gift.qr && res.gift.code) {
        writeLocal(slug, { gift: { qr: res.gift.qr, code: res.gift.code } });
        setLocalGift({ qr: res.gift.qr, code: res.gift.code });
      }
      setSubmission((s) => (s ? { ...s, gift: { ...s.gift, ...res.gift } } : s));
    } catch {
      setReissueError("Chưa tạo lại được mã — vui lòng thử lại hoặc liên hệ nhân viên.");
    } finally {
      setReissuing(false);
    }
  };

  /** Cùng SĐT còn suất (nhiều khách đã check-in): mở phiếu mới cho người đi cùng trên máy này. */
  const newForCompanion = () => {
    clearLocal(slug);
    setToken(null); setSession(null); setDraft(null); setLocalGift(null); setSubmission(null);
    setSubmitError(null); setStartError(null);
    setScreen("identify");
    window.scrollTo(0, 0);
  };

  // Cập nhật trạng thái quà (vd. nhân viên vừa trao) khi màn cảm ơn đang mở.
  useEffect(() => {
    if (screen !== "thanks" || !token || submission?.gift.variant !== "gift" || submission.gift.status === "redeemed") return;
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const s = await surveyApi.session(slug, token);
        if (s.submission) setSubmission((prev) => (prev ? { ...prev, gift: { ...s.submission!.gift, qr: prev.gift.qr, code: prev.gift.code } } : s.submission));
      } catch { /* thử lại lần sau */ }
    }, 20000);
    return () => clearInterval(timer);
  }, [screen, token, slug, submission?.gift.variant, submission?.gift.status]);

  const favorites = useMemo(() => {
    if (!data || !draft) return [];
    const map = new Map(data.items.map((i) => [i.key, i]));
    return draft.favorites.map((k) => map.get(k)).filter(Boolean) as PublicSurvey["items"];
  }, [data, draft]);

  // ---------- Render ----------
  if (screen === "loading") return <div className="lm-root"><LoadingScreen /></div>;
  if (screen === "invalid") return <div className="lm-root"><InvalidScreen path={`/survey/${slug}`} /></div>;
  if (screen === "error" || !data) {
    return (
      <div className="lm-root">
        <main className="lm-state lm-narrow">
          <h1 className="lm-h1">Chưa tải được khảo sát</h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: "23px" }}>Kết nối mạng đang chập chờn. Lựa chọn đã lưu vẫn còn nguyên.</p>
          <button type="button" className="lm-btn lm-btn-primary lm-btn-block" onClick={() => window.location.reload()}>Thử lại</button>
        </main>
      </div>
    );
  }
  if (screen === "closed" || screen === "not_open") {
    const likedCount = draft?.favorites.length || readLocal(slug).draft?.favorites?.length || 0;
    return (
      <div className="lm-root">
        <ClosedScreen data={data} likedCount={likedCount} notOpen={screen === "not_open"}
          onViewLiked={draft && likedCount ? () => setScreen("liked_readonly") : undefined} />
      </div>
    );
  }
  if (screen === "identify") {
    return <div className="lm-root"><IdentifyScreen data={data} busy={startBusy} serverError={startError} onStart={start} /></div>;
  }
  if (screen === "resume" && session && draft) {
    return (
      <div className="lm-root">
        <ResumeScreen data={data} name={session.full_name} favorites={favorites}
          adjCount={draft.adjectives.length + draft.others.filter((o) => o.trim()).length} savedAt={savedAt}
          onContinue={() => setScreen("app")} onFinish={() => { setInitialTab("finish"); setScreen("app"); }} onReset={resetSession} />
      </div>
    );
  }
  if (screen === "thanks" && submission && session) {
    return (
      <div className="lm-root">
        <ThanksScreen data={data} name={session.full_name} phoneMasked={session.phone_masked} submission={submission}
          localGift={localGift} reissuing={reissuing} reissueError={reissueError} onReissue={reissue} onCompanion={newForCompanion} />
      </div>
    );
  }
  if ((screen === "app" || screen === "liked_readonly") && session && draft) {
    return (
      <SurveyShell data={data} draft={draft} update={update} saveState={saveState} savedAt={savedAt}
        name={session.full_name} phoneMasked={session.phone_masked} initialTab={screen === "liked_readonly" ? "liked" : initialTab}
        readOnly={screen === "liked_readonly"} submitting={submitting} submitError={submitError} onSubmit={submit} />
    );
  }
  return <div className="lm-root"><LoadingScreen /></div>;
}

