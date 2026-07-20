"use client";

import { useEffect, useId, useRef, useState } from "react";
import { checkinGuestByQr, getGuestQrInfo, type GuestQrInfo } from "@/lib/api";

interface GuestQrScannerProps {
  workshopId: string;
  workshopSlug: string;
  onClose: () => void;
  onCheckedIn: (guestName: string, actualPartySize: number) => void | Promise<void>;
}

type ScannerStep = "camera" | "confirm" | "success" | "error";

function parseGuestQr(decodedText: string): { guestId: string; workshopSlug: string } | null {
  try {
    const url = new URL(decodedText);
    const guestId = url.searchParams.get("g") || "";
    const workshopSlug = url.searchParams.get("w") || "";
    if (url.pathname !== "/checkin-self" || !guestId || !workshopSlug) return null;
    return { guestId, workshopSlug };
  } catch {
    return null;
  }
}

export default function GuestQrScanner({
  workshopId,
  workshopSlug,
  onClose,
  onCheckedIn,
}: GuestQrScannerProps) {
  const rawId = useId();
  const readerId = `guest-qr-reader-${rawId.replace(/:/g, "")}`;
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const handlingRef = useRef(false);
  const [step, setStep] = useState<ScannerStep>("camera");
  const [guest, setGuest] = useState<GuestQrInfo | null>(null);
  const [actual, setActual] = useState(1);
  const [message, setMessage] = useState("Đưa mã QR khách mời vào khung hình");
  const [busy, setBusy] = useState(false);

  const stopScanner = async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
      scanner.clear();
    } catch {
      /* Camera có thể đã dừng khi đóng modal. */
    }
  };

  useEffect(() => {
    if (step !== "camera") return;
    let cancelled = false;

    const start = async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new Html5Qrcode(readerId, { verbose: false });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1 },
          async (decodedText) => {
            if (handlingRef.current) return;
            handlingRef.current = true;
            const parsed = parseGuestQr(decodedText);
            if (!parsed) {
              setMessage("QR không hợp lệ. Vui lòng quét QR khách mời.");
              handlingRef.current = false;
              return;
            }
            if (parsed.workshopSlug !== workshopSlug) {
              await stopScanner();
              setMessage("QR thuộc workshop khác với workshop đang chọn.");
              setStep("error");
              return;
            }
            try {
              const info = await getGuestQrInfo(parsed.guestId);
              if (info.workshop_id !== workshopId || info.workshop_slug !== workshopSlug) {
                throw new Error("QR thuộc workshop khác với workshop đang chọn.");
              }
              await stopScanner();
              setGuest(info);
              setActual(info.party_size || 1);
              setStep("confirm");
            } catch (error: any) {
              await stopScanner();
              setMessage(error?.message?.includes("workshop khác")
                ? error.message
                : "Không tìm thấy khách mời từ QR này.");
              setStep("error");
            }
          },
          () => undefined,
        );
      } catch {
        if (!cancelled) {
          setMessage("Không thể mở camera. Hãy cấp quyền camera và thử lại.");
          setStep("error");
        }
      }
    };

    start();
    return () => {
      cancelled = true;
      void stopScanner();
    };
  }, [readerId, step, workshopId, workshopSlug]);

  const scanAgain = () => {
    handlingRef.current = false;
    setGuest(null);
    setMessage("Đưa mã QR khách mời vào khung hình");
    setStep("camera");
  };

  const confirmCheckin = async () => {
    if (!guest || busy || guest.checkin_status === "checked_in") return;
    const count = Math.max(1, Math.floor(actual) || 1);
    setBusy(true);
    try {
      await checkinGuestByQr(guest.id, count);
      setStep("success");
      await onCheckedIn(guest.full_name, count);
    } catch (error: any) {
      setMessage("Check-in thất bại: " + (error?.message || "không rõ"));
      setStep("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" role="dialog" aria-modal="true" aria-label="Quét QR check-in">
      <div className="w-full max-w-md bg-surface rounded-t-2xl overflow-hidden pb-[env(safe-area-inset-bottom)]">
        <div className="px-4 py-3 flex items-center justify-between border-b border-line">
          <div>
            <h2 className="font-heading font-bold text-brand-teal">Quét QR check-in</h2>
            <p className="text-[11px] text-muted">{message}</p>
          </div>
          <button type="button" onClick={onClose} className="w-9 h-9 rounded-md border border-line text-brand-teal" aria-label="Đóng">×</button>
        </div>

        {step === "camera" && (
          <div className="p-4 bg-black">
            <div id={readerId} className="overflow-hidden rounded-lg bg-black min-h-[300px]" />
          </div>
        )}

        {step === "confirm" && guest && (
          <div className="p-4 space-y-4">
            <div className="rounded-lg border border-line bg-surface-muted p-4">
              <div className="text-xs text-muted">Khách mời</div>
              <div className="font-heading font-bold text-xl text-brand-teal mt-1">{guest.full_name}</div>
              {guest.company && <div className="text-sm text-muted mt-1">{guest.company}</div>}
              <div className="text-sm mt-3">Đăng ký: <strong>{guest.party_size || 1} khách</strong></div>
            </div>

            {guest.checkin_status === "checked_in" ? (
              <div className="rounded-lg border border-warning bg-amber-50 p-4 text-sm text-yellow-800">
                Khách đã check-in{guest.checked_in_at ? ` lúc ${new Date(guest.checked_in_at).toLocaleString("vi-VN")}` : ""}. Hệ thống không cộng thêm tự động.
              </div>
            ) : (
              <label className="block">
                <span className="block text-xs font-semibold text-text-secondary mb-1">Số khách check-in</span>
                <input
                  type="number"
                  min={1}
                  value={actual}
                  onChange={(event) => setActual(Math.max(1, parseInt(event.target.value, 10) || 1))}
                  className="w-full border border-line rounded-md px-3 py-3 text-lg text-center font-bold text-brand-teal"
                />
              </label>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={scanAgain} className="h-11 rounded-md border border-line text-brand-teal font-semibold">Quét lại</button>
              {guest.checkin_status !== "checked_in" && (
                <button type="button" onClick={confirmCheckin} disabled={busy} className="h-11 rounded-md border border-brand bg-brand text-brand-teal font-bold disabled:opacity-50">
                  {busy ? "Đang check-in..." : "Xác nhận check-in"}
                </button>
              )}
            </div>
          </div>
        )}

        {step === "success" && guest && (
          <div className="p-6 text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-success text-white text-3xl flex items-center justify-center">✓</div>
            <h3 className="font-heading font-bold text-xl text-success mt-3">Check-in thành công</h3>
            <p className="text-brand-teal mt-1">{guest.full_name} · {actual} khách</p>
            <div className="grid grid-cols-2 gap-2 mt-5">
              <button type="button" onClick={onClose} className="h-11 rounded-md border border-line text-brand-teal font-semibold">Đóng</button>
              <button type="button" onClick={scanAgain} className="h-11 rounded-md border border-brand bg-brand text-brand-teal font-bold">Quét tiếp</button>
            </div>
          </div>
        )}

        {step === "error" && (
          <div className="p-6 text-center">
            <div className="text-4xl">!</div>
            <p className="text-sm text-error mt-3">{message}</p>
            <div className="grid grid-cols-2 gap-2 mt-5">
              <button type="button" onClick={onClose} className="h-11 rounded-md border border-line text-brand-teal font-semibold">Đóng</button>
              <button type="button" onClick={scanAgain} className="h-11 rounded-md border border-brand bg-brand text-brand-teal font-bold">Thử lại</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
