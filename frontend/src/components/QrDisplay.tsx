"use client";
import { useRef, useState } from "react";
import QRCode from "react-qr-code";

interface QrDisplayProps {
  /** Workshop slug — sẽ được mã hóa thành /checkin-self?w=<slug> */
  workshopSlug: string;
  /** Kích thước QR (px). Mặc định 240 */
  size?: number;
  className?: string;
  /** Hiển thị nút Sao chép link + Tải xuống QR. Mặc định false. */
  showActions?: boolean;
  /** Hiển thị URL text bên dưới QR. Mặc định true. Tắt khi dùng trên TV/sân khấu
   * (khách chỉ cần quét, không cần đọc URL). */
  showUrl?: boolean;
}

/** Component hiển thị QR code dẫn tới trang self check-in của 1 workshop.
 *
 * URL = `${origin}/checkin-self?w=${workshopSlug}`
 * - Hiển thị cả URL text bên dưới để khách nhập tay nếu không scan được.
 * - Responsive: mobile-first, dùng được cả trên TV (kích thước lớn).
 */
export default function QrDisplay({
  workshopSlug,
  size = 240,
  className = "",
  showActions = false,
  showUrl = true,
}: QrDisplayProps) {
  // window có thể undefined trên SSR — guard
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}/checkin-self?w=${workshopSlug}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard không khả dụng */
    }
  };

  const downloadQr = () => {
    const svg = wrapRef.current?.querySelector("svg");
    if (!svg) return;
    const scale = 4;
    const svgData = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const objUrl = URL.createObjectURL(svgBlob);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size * scale;
      canvas.height = size * scale;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      URL.revokeObjectURL(objUrl);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `qr-checkin-${workshopSlug}.png`;
      a.click();
    };
    img.src = objUrl;
  };

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <div
        ref={wrapRef}
        className="bg-white p-3 rounded-lg border border-line"
        style={{ width: size + 24, height: size + 24 }}
      >
        <QRCode
          value={url}
          size={size}
          level="M"
          style={{ height: "auto", maxWidth: "100%", width: "100%" }}
        />
      </div>

      {showActions ? (
        <div className="w-full max-w-[280px] flex flex-col gap-2">
          {showUrl && (
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span aria-hidden>🔗</span>
              <span className="truncate" title={url}>{url}</span>
            </div>
          )}
          <button
            onClick={copyLink}
            className="border border-line text-brand-teal px-3 py-1.5 rounded-sm text-sm hover:bg-brand/5"
          >
            {copied ? "Đã sao chép ✓" : "Sao chép link"}
          </button>
          <button
            onClick={downloadQr}
            className="border border-brand text-brand px-3 py-1.5 rounded-sm text-sm hover:bg-brand/5"
          >
            Tải xuống QR
          </button>
        </div>
      ) : showUrl ? (
        <div className="text-xs text-muted text-center break-all max-w-[280px]">
          {url}
        </div>
      ) : null}
    </div>
  );
}
