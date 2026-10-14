"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

// Trang này phụ thuộc hoàn toàn vào query param `w` (slug workshop) ở runtime
// nên không thể prerender tĩnh được.
export const dynamic = "force-dynamic";

import {
  lookupByPhone,
  selfRegisterAndCheckin,
  selfCheckinGuestById,
  getWorkshopBySlug,
} from "@/lib/api";
import { formatEventDateTime, shortLocation } from "@/lib/date-format";

/** Ô số người với nút −/+ lớn, dễ bấm trên điện thoại tại quầy check-in. */
function CountStepper({ id, value, onChange, label }: { id: string; value: number; onChange: (value: number) => void; label: string }) {
  const set = (next: number) => onChange(Number.isFinite(next) ? Math.max(1, Math.floor(next)) : 1);
  return (
    <div className="grid min-h-[52px] grid-cols-[52px_minmax(0,1fr)_52px] overflow-hidden rounded-[14px] border-[1.5px] border-line bg-white transition focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/10">
      <button
        type="button"
        aria-label={`Giảm ${label}`}
        disabled={value <= 1}
        onClick={() => set(value - 1)}
        className="grid place-items-center text-2xl font-semibold text-brand-teal transition active:bg-brand/10 disabled:opacity-30"
      >
        −
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        className="min-w-0 border-x border-line bg-white px-2 py-3 text-center font-mono text-lg font-medium text-brand-teal focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label={`Tăng ${label}`}
        onClick={() => set(value + 1)}
        className="grid place-items-center text-2xl font-semibold text-brand-teal transition active:bg-brand/10"
      >
        +
      </button>
    </div>
  );
}

type Step = "loading" | "phone" | "confirm" | "register" | "success" | "error" | "wrong_workshop";

interface Guest {
  id: string;
  full_name: string;
  company?: string | null;
  party_size: number;
  checkin_status: string;
  actual_party_size?: number | null;
  phone?: string;
  checked_in_at?: string | null;
}

interface Workshop {
  id: string;
  name: string;
  slug: string;
  event_date?: string;
  event_time?: string | null;
  location?: string;
}

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

function normalizePhone(raw: string): string {
  // Bỏ hết ký tự không phải số, +84/84 → 0
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("84") && d.length >= 11) d = "0" + d.slice(2);
  return d;
}

// -----------------------------------------------------------------
// Page
// -----------------------------------------------------------------

export default function CheckinSelfPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center bg-surface-muted p-4">
        <div className="text-muted">Đang tải…</div>
      </main>
    }>
      <CheckinSelfInner />
    </Suspense>
  );
}

function CheckinSelfInner() {
  const sp = useSearchParams();
  const slug = sp.get("w") || "";

  const [workshop, setWorkshop] = useState<Workshop | null>(null);
  const [step, setStep] = useState<Step>("loading");
  const [phone, setPhone] = useState("");
  const [guest, setGuest] = useState<Guest | null>(null);
  const [partySize, setPartySize] = useState(1);
  const [actual, setActual] = useState(1);
  const [extra, setExtra] = useState(1);
  const [errMsg, setErrMsg] = useState("");
  const phoneRef = useRef<HTMLInputElement>(null);

  // Register form (khi SĐT không có trong DS)
  const [regName, setRegName] = useState("");
  const [regActual, setRegActual] = useState(1);
  // Tên workshop khác mà SĐT đã đăng ký; khác rỗng nghĩa là khách đang đăng ký thêm workshop hiện tại.
  const [otherWorkshop, setOtherWorkshop] = useState("");

  const resetKiosk = () => {
    setPhone("");
    setGuest(null);
    setErrMsg("");
    setOtherWorkshop("");
    setStep("phone");
    requestAnimationFrame(() => phoneRef.current?.focus());
  };

  useEffect(() => {
    if (!slug) {
      setErrMsg("Thiếu workshop. Vui lòng quét lại QR.");
      setStep("error");
      return;
    }
    (async () => {
      try {
        const w = await getWorkshopBySlug(slug);
        setWorkshop(w);
        setStep("phone");
      } catch {
        setErrMsg("Workshop không tồn tại hoặc đã bị xoá.");
        setStep("error");
      }
    })();
  }, [slug]);

  // -----------------------------------------------------------------
  // Step 1: nhập SĐT → lookup
  // -----------------------------------------------------------------
  const handleLookup = async () => {
    const norm = normalizePhone(phone);
    if (norm.length < 9 || norm.length > 11) {
      setErrMsg("Số điện thoại không hợp lệ (cần 9-11 số).");
      return;
    }
    try {
      const res = await lookupByPhone(norm, slug);
      if (res.found && res.guest) {
        setGuest(res.guest);
        const defaultActual = res.guest.party_size || 1;
        setPartySize(defaultActual);
        setActual(defaultActual);
        setExtra(1);
        if (res.guest.checkin_status === "checked_in") {
          // Đã check-in → vẫn cho phép cộng dồn (không reset state)
          setStep("confirm");
        } else {
          setStep("confirm");
        }
      } else if (res.reason === "wrong_workshop") {
        setErrMsg("");
        setOtherWorkshop(res.other_workshop_name || "workshop khác");
        setStep("wrong_workshop");
      } else {
        // not_in_workshop → cho đăng ký nhanh
        setStep("register");
      }
    } catch (e: any) {
      setErrMsg("Lỗi kết nối, vui lòng thử lại: " + (e?.message || ""));
    }
  };

  // -----------------------------------------------------------------
  // Step 2a: tìm thấy khách → cộng dồn + confirm
  // -----------------------------------------------------------------
  const handleConfirmCheckin = async () => {
    if (!guest) return;
    const newParty = Math.max(1, Math.floor(actual) || 1);
    try {
      await selfCheckinGuestById(guest.id, slug, normalizePhone(phone), newParty);
      setStep("success");
    } catch (e: any) {
      setErrMsg("Lỗi check-in: " + (e?.message || ""));
    }
  };

  // -----------------------------------------------------------------
  // Step 2b: tìm thấy nhưng đã check-in → cho cộng thêm extra
  // -----------------------------------------------------------------
  const handleExtraCheckin = async () => {
    if (!guest) return;
    const added = Math.max(1, Math.floor(extra) || 1);
    try {
      await selfCheckinGuestById(guest.id, slug, normalizePhone(phone), added);
      setStep("success");
    } catch (e: any) {
      setErrMsg("Lỗi cập nhật: " + (e?.message || ""));
    }
  };

  // -----------------------------------------------------------------
  // Step 3: đăng ký nhanh (SĐT không có trong DS)
  // -----------------------------------------------------------------
  const handleRegister = async () => {
    if (!regName.trim()) {
      setErrMsg("Vui lòng nhập họ tên.");
      return;
    }
    const norm = normalizePhone(phone);
    const newActual = Math.max(1, Math.floor(regActual) || 1);
    try {
      const res = await selfRegisterAndCheckin({
        workshop_slug: slug,
        full_name: regName.trim(),
        phone: norm,
        actual_party_size: newActual,
      });
      setGuest(res.guest);
      setStep("success");
    } catch (e: any) {
      setErrMsg("Lỗi đăng ký: " + (e?.message || ""));
    }
  };

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------

  if (step === "loading") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-surface-muted p-4">
        <div className="text-muted">Đang tải…</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-surface-muted">
      <div className="max-w-md mx-auto p-4 sm:p-6">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="text-brand text-[10px] font-semibold tracking-widest">
            HI SWEETIE VIỆT NAM
          </div>
          <h1 className="text-xl font-bold text-brand-teal mt-1">
            {workshop?.name || "Workshop"}
          </h1>
          {workshop?.event_date && (
            <div className="text-xs text-muted mt-0.5">{formatEventDateTime(workshop.event_date, workshop.event_time, true)}{workshop.location ? ` · ${shortLocation(workshop.location)}` : ""}</div>
          )}
        </div>

        {/* Error banner */}
        {errMsg && (
          <div id="checkin-error" role="alert" className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
            {errMsg}
          </div>
        )}

        {/* ───── Step: phone ───── */}
        {step === "phone" && (
          <form className="bg-surface rounded-lg border border-line p-5 space-y-4" onSubmit={(event) => { event.preventDefault(); void handleLookup(); }}>
            <div>
              <label htmlFor="checkin-phone" className="text-base font-semibold text-ink">Nhập số điện thoại đã đăng ký</label>
              <div id="checkin-phone-hint" className="text-xs text-muted mt-1">
                Hệ thống sẽ tìm trong danh sách của <b>{workshop?.name}</b>.
              </div>
            </div>
            <input
              id="checkin-phone"
              ref={phoneRef}
              name="phone"
              type="tel"
              autoFocus
              inputMode="tel"
              autoComplete="tel"
              aria-invalid={Boolean(errMsg)}
              aria-describedby={errMsg ? "checkin-phone-hint checkin-error" : "checkin-phone-hint"}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0909 123 456"
              className="w-full border border-line rounded-md px-4 py-3 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <button
              type="submit"
              disabled={!phone.trim()}
              className="w-full bg-brand text-brand-teal font-semibold py-3 rounded-md disabled:opacity-50"
            >
              Tiếp tục
            </button>
          </form>
        )}

        {/* ───── Step: confirm (tìm thấy khách) ───── */}
        {step === "confirm" && guest && (
          <div className="bg-surface rounded-lg border border-line p-5 space-y-4">
            <div>
              <div className="text-base font-semibold text-green-700">
                Xin chào {guest.full_name}
              </div>
              {guest.company && (
                <div className="text-xs text-muted mt-1">
                  Công ty: <b>{guest.company}</b>
                </div>
              )}
              <div className="text-xs text-muted">
                Số vé đăng ký: <b>{guest.party_size}</b>
              </div>
              {guest.checkin_status === "checked_in" && (
                <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 text-xs text-yellow-800 rounded">
                  Bạn đã check-in lúc{" "}
                  {guest.checked_in_at
                    ? new Date(guest.checked_in_at).toLocaleString("vi-VN")
                    : "trước đó"}
                  . Có thể cộng thêm số người bên dưới.
                </div>
              )}
            </div>

            {guest.checkin_status !== "checked_in" ? (
              <>
                <div>
                  <label htmlFor="checkin-actual" className="block text-sm font-medium text-ink mb-1">
                    Số người tham gia thực tế
                  </label>
                  <CountStepper id="checkin-actual" value={actual} onChange={setActual} label="số người tham gia thực tế" />
                  <div className="text-xs text-muted mt-1">
                    (Mặc định = số vé đăng ký)
                  </div>
                </div>
                <button
                  onClick={handleConfirmCheckin}
                  className="w-full bg-green-600 text-white font-semibold py-3 rounded-md"
                >
                  Check-in
                </button>
              </>
            ) : (
              <>
                <div>
                  <label htmlFor="checkin-extra" className="block text-sm font-medium text-ink mb-1">
                    Cộng thêm số người tham gia
                  </label>
                  <CountStepper id="checkin-extra" value={extra} onChange={setExtra} label="số người cộng thêm" />
                </div>
                <button
                  onClick={handleExtraCheckin}
                  className="w-full bg-green-600 text-white font-semibold py-3 rounded-md"
                >
                  Cập nhật số người
                </button>
              </>
            )}
            <button
              onClick={resetKiosk}
              className="w-full text-muted text-sm py-2"
            >
              ← Nhập lại số điện thoại
            </button>
          </div>
        )}

        {/* ───── Step: register (không có trong DS) ───── */}
        {step === "register" && (
          <div className="bg-surface rounded-lg border border-line p-5 space-y-4">
            <div>
              <div className="text-base font-semibold text-yellow-700">
                {otherWorkshop ? "Đăng ký tham gia workshop này" : "Số điện thoại chưa có trong danh sách"}
              </div>
              <div className="text-xs text-muted mt-1">
                {otherWorkshop
                  ? <>Đăng ký mới cho workshop <b>{workshop?.name}</b>. Đăng ký ở workshop &quot;{otherWorkshop}&quot; vẫn được giữ nguyên.</>
                  : <>Workshop <b>{workshop?.name}</b>. Bạn có thể đăng ký nhanh tại đây hoặc đến quầy để nhân viên hỗ trợ.</>}
              </div>
            </div>

            <div>
              <label htmlFor="checkin-register-name" className="block text-sm font-medium text-ink mb-1">
                Họ và tên *
              </label>
              <input
                id="checkin-register-name" name="name" autoComplete="name"
                autoFocus
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="Nguyễn Văn A"
                className="w-full border border-line rounded-md px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>

            <div>
              <label htmlFor="checkin-register-party" className="block text-sm font-medium text-ink mb-1">
                Số người tham gia *
              </label>
              <CountStepper id="checkin-register-party" value={regActual} onChange={setRegActual} label="số người tham gia" />
            </div>

            <button
              onClick={handleRegister}
              disabled={!regName.trim()}
              className="w-full bg-brand text-brand-teal font-semibold py-3 rounded-md disabled:opacity-50"
            >
              Đăng ký &amp; Check-in
            </button>
            <button
              onClick={resetKiosk}
              className="w-full text-muted text-sm py-2"
            >
              ← Thử lại số khác
            </button>
          </div>
        )}

        {/* ───── Step: success ───── */}
        {step === "success" && guest && (
          <div role="status" aria-live="polite" className="bg-surface rounded-lg border border-line p-6 space-y-4 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-green-100 text-green-700" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-8 w-8"><path d="m5 12 4 4L19 6" /></svg>
            </div>
            <div>
              <div className="text-xl font-bold text-green-700">
                Check-in thành công!
              </div>
              <div className="text-base text-ink mt-2">
                Cảm ơn <b>{guest.full_name}</b>
              </div>
              <div className="text-sm text-muted mt-1">
                Số người tham gia: <b>{guest.actual_party_size || guest.party_size || 1}</b> vé
              </div>
            </div>
            <div className="pt-3 border-t border-line text-xs text-muted">
              Vui lòng vào khu vực workshop. Chúc anh/chị buổi trải nghiệm vui vẻ!
            </div>
          </div>
        )}

        {/* ───── Step: error ───── */}
        {step === "error" && (
          <div className="bg-surface rounded-lg border border-line p-6 text-center space-y-3">
            <div className="text-4xl">😕</div>
            <div className="text-sm text-muted">{errMsg}</div>
            <a
              href="/"
              className="inline-block text-brand underline text-sm"
            >
              ← Về trang chính
            </a>
          </div>
        )}

        {/* ───── Step: wrong_workshop ───── */}
        {step === "wrong_workshop" && (
          <div className="bg-surface rounded-lg border border-line p-6 space-y-4 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-50 text-amber-700" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7"><path d="M16 3h5v5" /><path d="M4 20 21 3" /><path d="M21 16v5h-5" /><path d="m15 15 6 6" /><path d="M4 4l5 5" /></svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">Số điện thoại đã đăng ký workshop khác</h2>
              <p className="mt-1 text-sm text-muted">Số <b className="font-mono text-ink">{phone}</b> đang đăng ký <b className="text-ink">&quot;{otherWorkshop}&quot;</b>.</p>
            </div>
            <p className="rounded-md bg-surface-muted px-3 py-2 text-sm text-ink">
              Bạn có muốn đăng ký và check-in workshop <b>{workshop?.name}</b> không?
            </p>
            <div className="space-y-2">
              <button
                type="button"
                autoFocus
                onClick={() => { setErrMsg(""); setRegName(""); setRegActual(1); setStep("register"); }}
                className="h-12 w-full rounded-md bg-brand font-semibold text-brand-teal"
              >
                Có, đăng ký workshop này
              </button>
              <button type="button" onClick={resetKiosk} className="h-11 w-full rounded-md border border-line text-sm font-medium text-ink">
                Không, thử số khác
              </button>
            </div>
            <p className="text-xs text-muted">Nếu muốn chuyển đăng ký từ workshop khác sang, vui lòng đến quầy để nhân viên hỗ trợ.</p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 text-center text-xs text-muted tracking-widest">
          HI SWEETIE VIỆT NAM · WORKSHOP
        </div>
      </div>
    </main>
  );
}
