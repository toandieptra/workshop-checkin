"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// Trang này phụ thuộc hoàn toàn vào query param `w` (slug workshop) ở runtime
// nên không thể prerender tĩnh được.
export const dynamic = "force-dynamic";

import {
  lookupByPhone,
  selfRegisterAndCheckin,
  checkinGuestById,
  getWorkshopBySlug,
} from "@/lib/api";

type Step = "loading" | "phone" | "confirm" | "register" | "success" | "error" | "wrong_workshop";

interface Guest {
  id: string;
  full_name: string;
  company?: string;
  party_size: number;
  checkin_status: string;
  actual_party_size?: number | null;
  phone?: string;
  checked_in_at?: string;
}

interface Workshop {
  id: string;
  name: string;
  slug: string;
  event_date?: string;
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

  // Register form (khi SĐT không có trong DS)
  const [regName, setRegName] = useState("");
  const [regActual, setRegActual] = useState(1);

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
        setErrMsg(`Số điện thoại này đăng ký workshop khác: "${res.other_workshop_name || "?"}". Vui lòng đến quầy để chuyển.`);
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
      await checkinGuestById(guest.id, newParty);
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
      await checkinGuestById(guest.id, added);
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
            <div className="text-xs text-muted mt-0.5">{workshop.event_date}</div>
          )}
        </div>

        {/* Error banner */}
        {errMsg && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
            {errMsg}
          </div>
        )}

        {/* ───── Step: phone ───── */}
        {step === "phone" && (
          <div className="bg-surface rounded-lg border border-line p-5 space-y-4">
            <div>
              <div className="text-base font-semibold text-ink">
                📱 Nhập số điện thoại đã đăng ký
              </div>
              <div className="text-xs text-muted mt-1">
                Hệ thống sẽ tìm trong danh sách của <b>{workshop?.name}</b>.
              </div>
            </div>
            <input
              autoFocus
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLookup()}
              placeholder="0909 123 456"
              className="w-full border border-line rounded-md px-4 py-3 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <button
              onClick={handleLookup}
              disabled={!phone.trim()}
              className="w-full bg-brand text-white font-semibold py-3 rounded-md disabled:opacity-50"
            >
              Tiếp tục →
            </button>
          </div>
        )}

        {/* ───── Step: confirm (tìm thấy khách) ───── */}
        {step === "confirm" && guest && (
          <div className="bg-surface rounded-lg border border-line p-5 space-y-4">
            <div>
              <div className="text-base font-semibold text-green-700">
                ✅ Xin chào {guest.full_name}
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
                  ⚠️ Bạn đã check-in lúc{" "}
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
                  <label className="block text-sm font-medium text-ink mb-1">
                    Số người tham gia thực tế
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={actual}
                    onChange={(e) => setActual(parseInt(e.target.value) || 1)}
                    className="w-full border border-line rounded-md px-4 py-3 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-brand"
                  />
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
                  <label className="block text-sm font-medium text-ink mb-1">
                    Cộng thêm số người tham gia
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={extra}
                    onChange={(e) => setExtra(parseInt(e.target.value) || 1)}
                    className="w-full border border-line rounded-md px-4 py-3 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-brand"
                  />
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
              onClick={() => { setStep("phone"); setGuest(null); setErrMsg(""); }}
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
                ⚠️ Số điện thoại chưa có trong danh sách
              </div>
              <div className="text-xs text-muted mt-1">
                Workshop <b>{workshop?.name}</b>. Bạn có thể đăng ký nhanh tại đây hoặc đến quầy để nhân viên hỗ trợ.
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Họ và tên *
              </label>
              <input
                autoFocus
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="Nguyễn Văn A"
                className="w-full border border-line rounded-md px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Số người tham gia *
              </label>
              <input
                type="number"
                min={1}
                value={regActual}
                onChange={(e) => setRegActual(parseInt(e.target.value) || 1)}
                className="w-full border border-line rounded-md px-4 py-3 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>

            <button
              onClick={handleRegister}
              disabled={!regName.trim()}
              className="w-full bg-brand text-white font-semibold py-3 rounded-md disabled:opacity-50"
            >
              Đăng ký &amp; Check-in
            </button>
            <button
              onClick={() => { setStep("phone"); setErrMsg(""); }}
              className="w-full text-muted text-sm py-2"
            >
              ← Thử lại số khác
            </button>
          </div>
        )}

        {/* ───── Step: success ───── */}
        {step === "success" && guest && (
          <div className="bg-surface rounded-lg border border-line p-6 space-y-4 text-center">
            <div className="text-6xl">✅</div>
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
          <div className="bg-surface rounded-lg border border-line p-6 text-center space-y-3">
            <div className="text-4xl">🔀</div>
            <div className="text-sm">{errMsg}</div>
            <button
              onClick={() => setStep("phone")}
              className="text-brand underline text-sm"
            >
              ← Thử số khác
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 text-center text-[10px] text-muted tracking-widest">
          HI SWEETIE VIỆT NAM · WORKSHOP
        </div>
      </div>
    </main>
  );
}