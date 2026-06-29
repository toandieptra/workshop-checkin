"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import {
  createUploadSession,
  getUploadSession,
  closeUploadSession,
  buildMobileUrl,
  UploadSession,
} from "@/lib/uploadSessions";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called khi staff bam "Ap dung" - tra danh sach URL anh de admin push vao form. */
  onApply: (urls: string[]) => Promise<void> | void;
}

export default function QrUploadModal({ open, onClose, onApply }: Props) {
  const [session, setSession] = useState<UploadSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const [applying, setApplying] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  const pollRef = useRef<any>(null);

  // create session khi mo modal
  useEffect(() => {
    if (!open) return;
    setSession(null);
    setError(null);
    seenRef.current = new Set();
    setNow(Date.now());
    let alive = true;
    createUploadSession(30)
      .then((s) => {
        if (!alive) return;
        setSession(s);
        (s.images || []).forEach((i) => i.url && seenRef.current.add(i.url));
      })
      .catch((e) => alive && setError(e?.message || "Khong tao duoc phien upload"));
    return () => { alive = false; };
  }, [open]);

  // polling
  useEffect(() => {
    if (!open || !session) return;
    const sid = session.id;
    const token = session.token!;
    pollRef.current = setInterval(async () => {
      try {
        const s = await getUploadSession(sid, token);
        setSession(s);
        let fresh: string[] = [];
        (s.images || []).forEach((i) => {
          if (i.url && !seenRef.current.has(i.url)) {
            seenRef.current.add(i.url);
            fresh.push(i.url);
          }
        });
      } catch {
        // session het han/closed -> dung poll
      }
    }, 2000);
    return () => clearInterval(pollRef.current);
  }, [open, session?.id]);

  // countdown
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  // cleanup khi dong modal
  useEffect(() => {
    if (open || !session) return;
    const token = session.token;
    const sid = session.id;
    if (!token) return;
    closeUploadSession(sid, token).catch(() => {});
  }, [open]);

  if (!open) return null;

  const expMs = session ? new Date(session.expires_at).getTime() : 0;
  const secondsLeft = Math.max(0, Math.floor((expMs - now) / 1000));
  const mm = Math.floor(secondsLeft / 60).toString().padStart(2, "0");
  const ss = (secondsLeft % 60).toString().padStart(2, "0");

  const urls = (session?.images || []).map((i) => i.url).filter(Boolean);

  const handleApply = async () => {
    if (!urls.length || applying) return;
    setApplying(true);
    try { await onApply(urls); } finally { setApplying(false); }
  };

  return (
    <div className="fixed inset-0 z-30 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-surface rounded-lg w-full max-w-md max-h-[90vh] overflow-auto">
        <div className="p-4 border-b border-line flex items-center justify-between">
          <h2 className="text-lg font-bold text-brand-teal">Upload ảnh bằng QR</h2>
          <button onClick={onClose} className="text-muted text-xl leading-none">×</button>
        </div>

        <div className="p-4 space-y-4">
          {error && <div className="text-red-600 text-sm">❌ {error}</div>}

          {!session && !error && (
            <div className="text-muted text-center py-10">Đang tạo phiên upload...</div>
          )}

          {session && (
            <>
              <div className="text-xs text-muted text-center">
                Quét QR bằng điện thoại (cùng WiFi). Hết hạn sau{" "}
                <span className={secondsLeft < 60 ? "text-red-600 font-semibold" : "text-brand font-semibold"}>
                  {mm}:{ss}
                </span>
              </div>

              <div className="flex justify-center bg-white p-3 rounded border border-line">
                <QRCode value={buildMobileUrl(session.upload_url, session.token!)} size={200} />
              </div>

              <div className="text-center">
                <a href={buildMobileUrl(session.upload_url, session.token!)} target="_blank" rel="noreferrer"
                  className="text-xs text-brand underline break-all">
                  {buildMobileUrl(session.upload_url, session.token!)}
                </a>
              </div>

              <div>
                <div className="text-sm font-medium mb-2">
                  Ảnh đã nhận <span className="text-brand">({urls.length})</span>
                </div>
                {urls.length === 0 ? (
                  <div className="text-xs text-muted italic border border-dashed border-line rounded p-3 text-center">
                    Chờ điện thoại gửi ảnh...
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {session.images.map((img, i) => (
                      <img key={i} src={img.url} alt="" className="w-full h-16 object-cover rounded border border-line" />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t border-line flex gap-2 justify-end">
          <button onClick={onClose} className="border border-line px-4 py-2 rounded-sm text-sm">Đóng</button>
          <button
            onClick={handleApply}
            disabled={!urls.length || applying}
            className="bg-brand text-white px-4 py-2 rounded-sm text-sm font-medium disabled:opacity-40"
          >
            {applying ? "Đang áp dụng..." : `Áp dụng ${urls.length ? `(${urls.length})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
