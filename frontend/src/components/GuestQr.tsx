"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";

interface GuestQrProps {
  guestId: string;
  guestName: string;
  workshopSlug: string;
  workshopName?: string;
  compact?: boolean;
}

function safeFileName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "khach-moi";
}

export function buildGuestQrUrl(origin: string, workshopSlug: string, guestId: string): string {
  const params = new URLSearchParams({ w: workshopSlug, g: guestId });
  return `${origin}/checkin-self?${params.toString()}`;
}

export default function GuestQr({
  guestId,
  guestName,
  workshopSlug,
  workshopName = "Workshop",
  compact = false,
}: GuestQrProps) {
  const [origin, setOrigin] = useState("");
  const [open, setOpen] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  const url = origin ? buildGuestQrUrl(origin, workshopSlug, guestId) : "";

  const downloadQr = () => {
    const svg = qrRef.current?.querySelector("svg");
    if (!svg) return;

    const width = 960;
    const qrSize = 720;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = 960;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const image = new Image();
    const objectUrl = URL.createObjectURL(new Blob([svgData], { type: "image/svg+xml;charset=utf-8" }));
    image.onload = () => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, (width - qrSize) / 2, 50, qrSize, qrSize);
      URL.revokeObjectURL(objectUrl);

      ctx.fillStyle = "#0D3B42";
      ctx.textAlign = "center";
      ctx.font = "700 42px sans-serif";
      ctx.fillText(guestName, width / 2, 835, width - 80);
      ctx.fillStyle = "#667577";
      ctx.font = "28px sans-serif";
      ctx.fillText(workshopName, width / 2, 885, width - 80);

      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `qr-${safeFileName(guestName)}.png`;
      link.click();
    };
    image.src = objectUrl;
  };

  return (
    <>
      <div className={compact ? "flex flex-col items-center gap-1.5" : ""}>
        {compact && url && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="bg-white p-1 border border-line rounded-sm hover:border-brand"
            aria-label={`Xem QR của ${guestName}`}
          >
            <QRCode value={url} size={54} level="M" />
          </button>
        )}
        <button
          type="button"
          onClick={compact ? downloadQr : () => setOpen(true)}
          disabled={!url}
          className={compact
            ? "text-[11px] text-brand underline disabled:opacity-40"
            : "inline-flex items-center justify-center gap-1 h-10 px-3 rounded-md border border-line text-brand-teal font-semibold text-xs bg-surface active:bg-cyan-pale disabled:opacity-40"}
        >
          {compact ? "Tải QR" : "QR khách"}
        </button>
      </div>

      {url && (
        <div ref={qrRef} className="fixed -left-[9999px] top-0" aria-hidden="true">
          <QRCode value={url} size={240} level="M" />
        </div>
      )}

      {open && url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`QR của ${guestName}`}
          onClick={() => setOpen(false)}
        >
          <div className="w-full max-w-sm bg-surface rounded-lg border border-line p-5 text-center" onClick={(event) => event.stopPropagation()}>
            <h3 className="font-heading font-bold text-lg text-brand-teal">{guestName}</h3>
            <p className="text-xs text-muted mt-1">{workshopName}</p>
            <div className="inline-block bg-white p-4 border border-line rounded-lg mt-4">
              <QRCode value={url} size={240} level="M" />
            </div>
            <p className="text-[10px] text-muted break-all mt-2">{url}</p>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button type="button" onClick={() => setOpen(false)} className="h-10 rounded-md border border-line text-sm text-brand-teal">
                Đóng
              </button>
              <button type="button" onClick={downloadQr} className="h-10 rounded-md border border-brand bg-brand text-brand-teal text-sm font-bold">
                Tải QR
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
