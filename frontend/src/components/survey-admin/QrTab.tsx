"use client";

import { useRef, useState } from "react";
import QRCode from "react-qr-code";
import { fmtDateTime, type SurveyAdmin } from "@/lib/survey-admin";

const STATE_TEXT: Record<string, string> = {
  draft: "Chưa xuất bản — link chưa hoạt động", open: "Đang mở nhận phiếu", not_open: "Đã xuất bản, chưa tới giờ mở", closed: "Đã đóng nhận phiếu",
};

export default function QrTab({ survey }: { survey: SurveyAdmin }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}${survey.public_path}` : survey.public_path;
  const live = survey.public_state === "open" || survey.public_state === "not_open";

  const svgString = () => {
    const svg = wrap.current?.querySelector("svg");
    return svg ? new XMLSerializer().serializeToString(svg) : "";
  };
  const download = (kind: "png" | "svg") => {
    const data = svgString();
    if (!data) return;
    const name = `qr-khao-sat-${survey.slug}`;
    if (kind === "svg") {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([data], { type: "image/svg+xml" }));
      a.download = `${name}.svg`;
      a.click();
      return;
    }
    const img = new Image();
    img.onload = () => {
      const size = 1200, pad = 80;
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, pad, pad, size - pad * 2, size - pad * 2);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `${name}.png`;
      a.click();
    };
    img.src = URL.createObjectURL(new Blob([data], { type: "image/svg+xml" }));
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt("Sao chép link:", url); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="flex flex-col items-center gap-3 rounded-md border border-line bg-surface p-6 text-center">
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#005a9f]">{survey.content.brand_line || "LERMAO"}</span>
        <h2 className="font-heading text-2xl font-extrabold text-black">{survey.title}</h2>
        <p className="text-base font-semibold">Quét để chọn món yêu thích &amp; góp ý</p>
        <div ref={wrap} className={`relative rounded-lg border border-line bg-white p-4 ${live ? "" : "opacity-40"}`} style={{ width: 352 }}>
          <QRCode value={url} size={320} level="H" style={{ width: "100%", height: "auto" }} />
          <img src="/survey/lermao-mascot.png" alt="" className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-white object-contain" />
        </div>
        {!live && <span className="rounded-full bg-surface-muted px-3 py-1 text-xs font-semibold text-muted">{STATE_TEXT[survey.public_state]}</span>}
        <p className="max-w-sm text-sm text-muted">Mở camera điện thoại → hướng vào mã → chạm vào đường link hiện ra. Không cần cài app.</p>
      </section>
      <section className="space-y-4 rounded-md border border-line bg-surface p-5 text-sm">
        <div>
          <h3 className="mb-1 font-semibold">Link khảo sát công khai</h3>
          <div className="flex gap-2">
            <code className="flex min-h-11 flex-1 items-center break-all rounded-md bg-surface-muted px-3">{url}</code>
            <button type="button" onClick={copy} className="min-h-11 rounded-md border border-brand px-3 font-semibold text-brand-accent">{copied ? "Đã sao chép" : "Sao chép"}</button>
          </div>
          {copied && <span role="status" className="mt-1 block text-xs text-success">Đã sao chép link</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => download("png")} className="min-h-11 rounded-md bg-brand px-4 font-semibold text-brand-teal">Tải PNG</button>
          <button type="button" onClick={() => download("svg")} className="min-h-11 rounded-md border border-line px-4 font-semibold">Tải SVG (in)</button>
          <a href={survey.public_path} target="_blank" rel="noreferrer" className={`flex min-h-11 items-center rounded-md border border-line px-4 font-semibold ${live ? "" : "pointer-events-none opacity-40"}`}>Xem thử survey ↗</a>
        </div>
        <dl className="grid grid-cols-[120px_1fr] gap-2 rounded-md bg-surface-muted p-3">
          <dt className="text-muted">Trạng thái</dt><dd className="font-semibold">{STATE_TEXT[survey.public_state]}</dd>
          <dt className="text-muted">Mở lúc</dt><dd>{survey.opens_at ? fmtDateTime(survey.opens_at) : "Ngay khi xuất bản"}</dd>
          <dt className="text-muted">Tự đóng</dt><dd>{survey.closes_at ? fmtDateTime(survey.closes_at) : "Khi bấm “Đóng nhận phiếu”"}</dd>
          <dt className="text-muted">Món</dt><dd>{survey.current_version_item_count ?? 0} món đang xuất bản · {survey.items.length} món trong bản nháp</dd>
        </dl>
        <p className="text-xs text-muted">Gợi ý in: khổ A5 đứng trên standee, QR ≥ 6 cm, đặt ở mỗi bàn thử món. Mã QR có logo ở giữa dùng mức sửa lỗi H.</p>
      </section>
    </div>
  );
}
