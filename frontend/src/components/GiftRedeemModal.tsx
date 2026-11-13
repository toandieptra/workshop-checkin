"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { fmtDateTime, GIFT_STATUS_LABEL, surveyAdminApi, type GiftLookup } from "@/lib/survey-admin";

type Step = "scan" | "checking" | "result" | "redeeming" | "done";
type AuditRow = { id: string; action: string; result: string; actor: string | null; created_at: string; method: string | null };

const RESULT_TONE: Record<string, "ok" | "warn" | "err"> = {
  ok: "ok", redeemed: "ok", already_redeemed: "warn", expired: "warn", revoked: "err", wrong_workshop: "err",
  not_found: "err", invalid_format: "err", gift_disabled: "warn", invalid_response: "err", invalid_registration: "err",
};
const TONE_CLS = {
  ok: "border-success-border bg-success-soft text-success",
  warn: "border-amber-300 bg-amber-50 text-warning",
  err: "border-red-200 bg-red-50 text-error",
};
const RESULT_LABEL: Record<string, string> = {
  ok: "hợp lệ", already_redeemed: "mã đã dùng", expired: "hết hạn", revoked: "đã thu hồi", wrong_workshop: "sai workshop",
  not_found: "không tìm thấy", invalid_format: "sai định dạng", gift_disabled: "quà đang tạm dừng",
  invalid_response: "phiếu không hợp lệ", invalid_registration: "đăng ký không hợp lệ",
};
const ACTION_LABEL: Record<string, string> = { redeem: "Trao quà", lookup: "Kiểm tra", revoke: "Thu hồi", reissue: "Cấp lại mã" };

function uuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

/**
 * Trao quà khảo sát cho workshop đang chọn ở trang Khách mời.
 * Quét/nhập mã chỉ tra cứu; quà chỉ được ghi nhận khi bấm “Xác nhận đã trao quà”.
 */
export default function GiftRedeemModal({ workshopId, workshopName, onClose, onRedeemed, initialCode }: {
  workshopId: string; workshopName: string; onClose: () => void; onRedeemed?: (guestId: string) => void;
  /** Mã QR đã quét ở màn "Quét QR" chung → kiểm tra ngay khi mở. */
  initialCode?: string | null;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, dialogRef);
  const [step, setStep] = useState<Step>("scan");
  const [camera, setCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [lookup, setLookup] = useState<GiftLookup | null>(null);
  const [pending, setPending] = useState<{ code: string; method: "qr" | "manual"; requestId: string } | null>(null);
  const [recent, setRecent] = useState<AuditRow[]>([]);
  const rawId = useId();
  const readerId = `gift-reader-${rawId.replace(/:/g, "")}`;
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const handling = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && step !== "redeeming") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  const loadRecent = useCallback(async () => {
    try { setRecent((await surveyAdminApi.audit(workshopId)).filter((r) => r.action !== "issue").slice(0, 8)); } catch { /* không bắt buộc */ }
  }, [workshopId]);
  useEffect(() => { void loadRecent(); }, [loadRecent]);

  const stopCamera = useCallback(async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (!s) return;
    try { if (s.isScanning) await s.stop(); s.clear(); } catch { /* đã dừng */ }
  }, []);

  const check = useCallback(async (code: string, method: "qr" | "manual") => {
    setStep("checking");
    setLookup(null);
    try {
      const res = await surveyAdminApi.lookup(workshopId, code, method);
      setLookup(res);
      setPending(res.can_redeem ? { code, method, requestId: uuid() } : null);
      if (navigator.vibrate) navigator.vibrate(res.can_redeem ? 30 : [60, 60, 60]);
    } catch (e: any) {
      setLookup({ result: "error", message: e?.message || "Không kiểm tra được mã — thử lại.", can_redeem: false, claim: null });
    } finally {
      setStep("result");
      void loadRecent();
    }
  }, [workshopId, loadRecent]);

  useEffect(() => {
    if (!camera || step !== "scan") return;
    let cancelled = false;
    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new Html5Qrcode(readerId, { verbose: false });
        scannerRef.current = scanner;
        await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1 }, async (text) => {
          if (handling.current) return;
          handling.current = true;
          await stopCamera();
          await check(text, "qr");
        }, () => undefined);
        setCameraError(null);
      } catch {
        if (!cancelled) { setCameraError("Không mở được camera. Cấp quyền camera hoặc nhập mã tay bên dưới."); setCamera(false); }
      }
    })();
    return () => { cancelled = true; void stopCamera(); };
  }, [camera, step, readerId, check, stopCamera]);

  const initialChecked = useRef(false);
  useEffect(() => {
    if (!initialCode || initialChecked.current) return;
    initialChecked.current = true;
    handling.current = true;
    void check(initialCode, "qr");
  }, [initialCode, check]);

  const redeem = async () => {
    if (!pending || !lookup?.claim || step === "redeeming") return;
    setStep("redeeming");
    try {
      const res = await surveyAdminApi.redeem(workshopId, { code: pending.code, claim_id: lookup.claim.claim_id, request_id: pending.requestId, method: pending.method });
      setLookup(res);
      setPending(null);
      setStep(res.result === "redeemed" ? "done" : "result");
      if (res.result === "redeemed" && res.claim?.guest_id) onRedeemed?.(res.claim.guest_id);
    } catch (e: any) {
      // Giữ nguyên request_id: bấm lại không bị trao trùng nhờ idempotency phía máy chủ.
      setLookup({ ...lookup, message: `Chưa xác nhận được (${e?.message || "lỗi mạng"}). Bấm lại để thử — không bị trao trùng.` });
      setStep("result");
    } finally { void loadRecent(); }
  };
  const next = () => {
    handling.current = false;
    setLookup(null); setPending(null); setManual("");
    setStep("scan");
  };

  const tone = lookup ? (RESULT_TONE[lookup.result] || "err") : "ok";
  const claim = lookup?.claim;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={(e) => { if (e.target === e.currentTarget && step !== "redeeming") onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="gift-redeem-title"
        className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-lg bg-surface shadow-xl sm:rounded-lg">
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id="gift-redeem-title" className="font-heading text-lg font-bold text-brand-teal">Trao quà khảo sát</h2>
            <p className="truncate text-xs text-muted">{workshopName}</p>
          </div>
          <button type="button" onClick={onClose} disabled={step === "redeeming"} aria-label="Đóng" className="min-h-11 min-w-11 text-2xl leading-none text-muted">×</button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
          {step === "scan" && (
            <>
              <p className="text-muted">Quét QR trên điện thoại khách hoặc nhập mã tay. Quét chỉ để kiểm tra — quà chỉ được ghi nhận khi bấm “Xác nhận đã trao quà”.</p>
              {camera ? (
                <div>
                  <div id={readerId} className="mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-md bg-black" />
                  <button type="button" onClick={() => setCamera(false)} className="mt-2 min-h-11 w-full rounded-md border border-line">Tắt camera</button>
                </div>
              ) : (
                <button type="button" onClick={() => { handling.current = false; setCamera(true); }} className="min-h-12 w-full rounded-md bg-brand text-base font-bold text-brand-teal">Mở camera quét QR</button>
              )}
              {cameraError && <p role="alert" className="text-error">{cameraError}</p>}
              <form onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { void stopCamera(); setCamera(false); void check(manual, "manual"); } }} className="flex gap-2">
                <label className="sr-only" htmlFor="gift-code">Mã nhập tay</label>
                <input id="gift-code" value={manual} onChange={(e) => setManual(e.target.value.toUpperCase())} placeholder="Mã nhập tay, VD: SMEC-L47C" autoComplete="off" autoCapitalize="characters"
                  className="min-h-12 min-w-0 flex-1 rounded-md border border-line px-3 font-mono text-base tracking-widest" />
                <button type="submit" disabled={!manual.trim()} className="min-h-12 rounded-md border border-brand px-4 font-semibold text-brand-accent disabled:opacity-40">Kiểm tra</button>
              </form>
            </>
          )}

          {step === "checking" && <div role="status" className="py-10 text-center text-muted">Đang kiểm tra mã…</div>}

          {(step === "result" || step === "redeeming" || step === "done") && lookup && (
            <div className="space-y-4">
              <div role={tone === "ok" ? "status" : "alert"} className={`rounded-md border px-4 py-3 text-base font-bold ${step === "done" ? TONE_CLS.ok : TONE_CLS[tone]}`}>
                {step === "done" ? "✓ Đã trao quà thành công" : lookup.message}
              </div>
              {claim && (
                <dl className="grid grid-cols-[104px_1fr] gap-2">
                  <dt className="text-muted">Khách</dt><dd className="text-base font-bold">{claim.guest_name} <span className="text-sm font-normal text-muted">{claim.phone_masked}</span></dd>
                  <dt className="text-muted">Quà</dt><dd className="font-semibold">{claim.gift_name}</dd>
                  <dt className="text-muted">Trạng thái</dt><dd>{GIFT_STATUS_LABEL[claim.status] || claim.status}</dd>
                  <dt className="text-muted">Gửi phiếu</dt><dd>{fmtDateTime(claim.submitted_at)}{claim.rating ? ` · ${claim.rating}/5 sao` : ""}</dd>
                  {claim.redeemed_at && (<><dt className="text-muted">Đã trao</dt><dd>{fmtDateTime(claim.redeemed_at)}{claim.redeemed_by ? ` · bởi ${claim.redeemed_by}` : ""}</dd></>)}
                  {claim.expires_at && (<><dt className="text-muted">Hạn đổi</dt><dd>{fmtDateTime(claim.expires_at)}</dd></>)}
                </dl>
              )}
              {pending && step !== "done" && (
                <button type="button" onClick={redeem} disabled={step === "redeeming"} className="min-h-12 w-full rounded-md bg-[#dd2746] text-base font-extrabold text-white disabled:opacity-70">
                  {step === "redeeming" ? "Đang xác nhận…" : "Xác nhận đã trao quà"}
                </button>
              )}
              <button type="button" onClick={next} disabled={step === "redeeming"} className="min-h-11 w-full rounded-md border border-line font-semibold">Quét mã tiếp theo</button>
            </div>
          )}

          {recent.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted">Hoạt động gần đây</h3>
              <ul className="divide-y divide-line rounded-md border border-line">
                {recent.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span>{ACTION_LABEL[r.action] || r.action} · <span className={r.result === "ok" ? "text-success" : "text-muted"}>{RESULT_LABEL[r.result] || r.result}</span>
                      {r.method ? <span className="text-muted"> · {r.method === "qr" ? "QR" : "mã tay"}</span> : null}</span>
                    <span className="shrink-0 text-xs text-muted">{r.actor || "Khách"} · {fmtDateTime(r.created_at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
