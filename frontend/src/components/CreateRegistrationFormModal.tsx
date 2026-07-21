"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import {
  createRegistrationForm,
  getWorkshops,
  type RegistrationForm,
} from "@/lib/api";
import { publicUrl as buildPublicUrl } from "@/lib/urls";

interface Workshop {
  id: string;
  name: string;
  slug: string;
  status?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (form: RegistrationForm) => void;
}

export default function CreateRegistrationFormModal({ open, onClose, onCreated }: Props) {
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [selectedWorkshopIds, setSelectedWorkshopIds] = useState<string[]>([]);
  const [greeting, setGreeting] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<RegistrationForm | null>(null);
  const [copied, setCopied] = useState(false);
  const qrWrapRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;

  // Load workshops mỗi khi mở modal
  useEffect(() => {
    if (!open) return;
    getWorkshops()
      .then((ws) => {
        // Ẩn workshop Nháp / Đã hủy khỏi danh sách tạo Form đăng ký
        const list = (ws || []).filter((w) => {
          const s = w.status || "draft";
          return s !== "draft" && s !== "cancelled";
        });
        setWorkshops(list);
        if (list[0]) setSelectedWorkshopIds((prev) => (prev.length ? prev : [list[0].id]));
      })
      .catch(() => setError("Không tải được danh sách workshop"));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => dialogRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [open, onClose]);

  // Reset state khi đóng
  useEffect(() => {
    if (open) return;
    setGreeting("");
    setSelectedWorkshopIds([]);
    setError("");
    setCreated(null);
    setCopied(false);
    setBusy(false);
  }, [open]);

  if (!open) return null;

  const publicUrl = created
    ? buildPublicUrl(`/register/${created.token}`) || `${window.location.origin}/register/${created.token}`
    : "";

  const submit = async () => {
    if (!selectedWorkshopIds.length || busy) return;
    setBusy(true);
    setError("");
    try {
      const form = await createRegistrationForm({
        workshop_ids: selectedWorkshopIds,
        greeting: greeting.trim() || undefined,
      });
      setCreated(form);
      onCreated?.(form);
    } catch (e: any) {
      setError("Lỗi tạo form: " + (e?.message || "không rõ"));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard không khả dụng */
    }
  };

  const downloadQr = () => {
    const svg = qrWrapRef.current?.querySelector("svg");
    if (!svg || !created) return;
    const size = 240;
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
      a.download = `form-dang-ky-${created.token}.png`;
      a.click();
    };
    img.src = objUrl;
  };

  const toggleWorkshop = (id: string) => {
    setSelectedWorkshopIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={() => !busy && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-registration-form-title"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-xl sm:max-h-[90vh] sm:rounded-md sm:pb-0"
        onClick={(e) => e.stopPropagation()}
      >
        {!created ? (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
              <div>
                <h2 id="create-registration-form-title" className="font-semibold text-brand-teal">Tạo Form Đăng Ký</h2>
                <p className="mt-1 text-xs text-muted">Tạo form để khách đăng ký tham gia workshop.</p>
              </div>
              <button type="button" onClick={onClose} disabled={busy} aria-label="Đóng" className="min-h-11 min-w-11 text-xl leading-none text-muted disabled:opacity-50">×</button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {error && <div role="alert" className="mb-3 p-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>}

              <div className="block mb-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="block text-muted text-xs">Workshop * (có thể chọn nhiều)</span>
                  <span className="text-xs text-brand-teal font-medium">Đã chọn {selectedWorkshopIds.length}</span>
                </div>
                <div className="border border-line rounded-sm max-h-72 overflow-y-auto bg-white">
                  {workshops.length === 0 && (
                    <div className="px-3 py-3 text-sm text-muted">— Chưa có workshop —</div>
                  )}
                  {workshops.map((w) => {
                    const checked = selectedWorkshopIds.includes(w.id);
                    return (
                      <label
                        key={w.id}
                        className={`flex min-h-11 items-start gap-3 px-3 py-2.5 text-sm cursor-pointer border-b border-line last:border-b-0 ${checked ? "bg-brand/10" : "hover:bg-brand/5"}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleWorkshop(w.id)}
                          className="mt-0.5 h-5 w-5 shrink-0 accent-brand"
                        />
                        <span className="font-medium text-ink">{w.name}</span>
                      </label>
                    );
                  })}
                </div>
                {!selectedWorkshopIds.length && (
                  <div className="text-red-600 text-xs mt-1">Vui lòng chọn ít nhất 1 workshop.</div>
                )}
              </div>

              <label className="block">
                <span className="block text-muted text-xs mb-1">Lời chào (không bắt buộc)</span>
                <textarea
                  className="border border-line rounded-sm px-3 py-2 w-full resize-none"
                  rows={3}
                  placeholder="VD: Chào anh/chị, mời đăng ký tham gia workshop của chúng tôi."
                  value={greeting}
                  onChange={(e) => setGreeting(e.target.value)}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-line bg-surface px-4 py-3 sm:flex sm:justify-end sm:px-5">
              <button
                onClick={onClose}
                disabled={busy}
                className="min-h-11 border border-line px-3 py-1.5 rounded-md text-sm disabled:opacity-50 sm:rounded-sm"
              >
                Hủy
              </button>
              <button
                onClick={submit}
                disabled={busy || !selectedWorkshopIds.length}
                className="min-h-11 bg-brand text-brand-teal px-3 py-1.5 rounded-md text-sm font-semibold disabled:opacity-50 sm:rounded-sm"
              >
                {busy ? "Đang tạo..." : "Tạo form"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="border-b border-line px-4 py-3 sm:px-5">
              <h2 id="create-registration-form-title" className="font-semibold text-brand-teal">Đã tạo form thành công</h2>
              <p className="mt-1 text-xs text-muted">Chia sẻ link hoặc mã QR dưới đây cho khách để họ đăng ký.</p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto px-4 py-4 sm:px-5">
              <div
                ref={qrWrapRef}
                className="bg-white p-3 rounded-lg border border-line"
                style={{ width: 240 + 24, height: 240 + 24 }}
              >
                <QRCode
                  value={publicUrl}
                  size={240}
                  level="M"
                  style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                />
              </div>

              <div className="w-full flex items-center gap-1.5 text-xs text-muted">
                <span aria-hidden>🔗</span>
                <span className="truncate font-mono" title={publicUrl}>
                  {publicUrl}
                </span>
              </div>

              <div className="w-full grid grid-cols-2 gap-2">
                <button
                  onClick={copyLink}
                  className="min-h-11 border border-line text-brand-teal px-3 py-1.5 rounded-md text-sm hover:bg-brand/5 sm:rounded-sm"
                >
                  {copied ? "Đã sao chép ✓" : "Sao chép link"}
                </button>
                <button
                  onClick={downloadQr}
                  className="min-h-11 border border-brand text-brand px-3 py-1.5 rounded-md text-sm hover:bg-brand/5 sm:rounded-sm"
                >
                  Tải xuống QR
                </button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center justify-center border border-line text-brand-teal px-3 py-1.5 rounded-md text-sm hover:bg-brand/5 text-center sm:rounded-sm"
                >
                  Mở form →
                </a>
                <button
                  onClick={onClose}
                  className="min-h-11 bg-brand text-brand-teal px-3 py-1.5 rounded-md text-sm font-semibold sm:rounded-sm"
                >
                  Đóng
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
