"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useCamera } from "@/hooks/useCamera";
import { useFaceDetector, type DetectedFace } from "@/hooks/useFaceDetector";
import { api, apiForm, API_URL, maskPhone } from "@/lib/api";

interface Guest {
  id: string; workshop_id: string; full_name: string; phone?: string; company?: string;
  role_title?: string; guest_type?: string; note?: string; checkin_status: string;
}
interface RecognizeResult {
  decision: string; similarity?: number; quality_score?: number;
  guest?: Guest; message: string; log_id?: string;
}

function drawCornerBrackets(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, len: number
) {
  // 4 corner brackets, moi goc la 2 duong thang vuong goc (chi ve goc, khong ve canh)
  ctx.beginPath();
  // top-left
  ctx.moveTo(x, y + len);
  ctx.lineTo(x, y);
  ctx.lineTo(x + len, y);
  // top-right
  ctx.moveTo(x + w - len, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + len);
  // bottom-right
  ctx.moveTo(x + w, y + h - len);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w - len, y + h);
  // bottom-left
  ctx.moveTo(x + len, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h - len);
  ctx.stroke();
}

export default function CheckinPage() {
  const cam = useCamera();
  const detector = useFaceDetector();
  const [workshops, setWorkshops] = useState<any[]>([]);
  const [workshopId, setWorkshopId] = useState<string>("");
  const [auto, setAuto] = useState(false);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RecognizeResult | null>(null);
  const [statusText, setStatusText] = useState("Đang chờ khách");
  const [query, setQuery] = useState("");
  const [searchRes, setSearchRes] = useState<Guest[]>([]);
  const [faces, setFaces] = useState<DetectedFace[]>([]);
  const [faceLabels, setFaceLabels] = useState<Record<number, string>>({});
  const [autoFireCount, setAutoFireCount] = useState(0);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const loopRef = useRef<any>(null);
  const nextTimerRef = useRef<any>(null);
  const detectLoopRef = useRef<any>(null);
  const faceIdRef = useRef(0);

  const clearNextTimer = () => {
    if (nextTimerRef.current) { clearTimeout(nextTimerRef.current); nextTimerRef.current = null; }
  };

  useEffect(() => {
    api("/workshops").then((ws) => {
      setWorkshops(ws);
      if (ws[0]) setWorkshopId(ws[0].id);
    }).catch(() => {});
    cam.start();
  }, []);

  const recognize = useCallback(async () => {
    if (busy || !workshopId) return;
    const blob = await cam.capture();
    if (!blob) return;
    setBusy(true);
    setStatusText("Đang nhận diện...");
    try {
      const form = new FormData();
      form.append("workshop_id", workshopId);
      form.append("file", blob, "frame.jpg");
      const res: RecognizeResult = await apiForm("/checkin/recognize", form);
      setResult(res);
      // neu match: gan ten vao bbox lon nhat (backend lay face lon nhat)
      if (res.guest && faces.length > 0) {
        const biggest = faces.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
        setFaceLabels((prev) => ({ ...prev, [biggest.id]: res.guest!.full_name }));
      }
      const matched = res.decision === "confirm" || res.decision === "auto" || res.decision === "duplicate";
      setPaused(matched);
      setStatusText(
        res.decision === "no_face" ? "Đang chờ khách"
        : res.decision === "reject" ? "Không tìm thấy"
        : res.decision === "duplicate" ? "Đã check-in trước đó — chờ Khách tiếp theo"
        : res.decision === "auto" ? "Đã nhận diện — chờ Khách tiếp theo"
        : "Cần xác nhận — chờ nhân viên"
      );
    } catch (e) {
      setStatusText("Lỗi nhận diện");
    } finally {
      setBusy(false);
    }
  }, [busy, workshopId, cam]);

  // giu callback recognize on dinh de interval khong bi cleanup moi render
  const recognizeRef = useRef(recognize);
  recognizeRef.current = recognize;

  // auto recognition loop moi 1.2s (pause khi vua match khach)
  useEffect(() => {
    if (!auto || paused || !workshopId) {
      clearInterval(loopRef.current);
      loopRef.current = null;
      return;
    }
    console.log("[checkin] auto-loop start, interval=1200ms");
    loopRef.current = setInterval(() => {
      setAutoFireCount((c) => c + 1);
      recognizeRef.current();
    }, 1200);
    return () => {
      console.log("[checkin] auto-loop cleanup");
      clearInterval(loopRef.current);
    };
  }, [auto, paused, workshopId]);

  // cleanup timer khi unmount
  useEffect(() => () => clearNextTimer(), []);

  // detect loop: chay khi video ready + detector ready, moi 200ms
  useEffect(() => {
    if (!detector.ready || !cam.ready) return;
    const tick = async () => {
      const v = cam.videoRef.current;
      if (v && v.videoWidth) {
        try {
          const detected = await detector.detect(v);
          // stable id: giu id cu theo vi tri xy gan nhat de label khong nhay
          setFaces((prev) => {
            if (prev.length === 0) return detected.map((f) => ({ ...f, id: faceIdRef.current++ }));
            const usedPrev = new Set<number>();
            return detected.map((f) => {
              let bestIdx = -1;
              let bestDist = Infinity;
              for (let i = 0; i < prev.length; i++) {
                if (usedPrev.has(i)) continue;
                const p = prev[i];
                const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
                const px = p.x + p.w / 2, py = p.y + p.h / 2;
                const d = Math.hypot(cx - px, cy - py);
                if (d < bestDist) { bestDist = d; bestIdx = i; }
              }
              if (bestIdx >= 0 && bestDist < Math.max(f.w, f.h)) {
                usedPrev.add(bestIdx);
                return { ...f, id: prev[bestIdx].id };
              }
              return { ...f, id: faceIdRef.current++ };
            });
          });
        } catch {}
      }
      detectLoopRef.current = setTimeout(tick, 200);
    };
    detectLoopRef.current = setTimeout(tick, 200);
    return () => clearTimeout(detectLoopRef.current);
  }, [detector.ready, cam.ready, detector, cam.videoRef]);

  // ve overlay khi faces/labels thay doi
  useEffect(() => {
    const canvas = overlayRef.current;
    const video = cam.videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = video.videoWidth || canvas.width;
    canvas.height = video.videoHeight || canvas.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 3;
    ctx.font = "600 14px system-ui, -apple-system, sans-serif";
    ctx.textBaseline = "middle";
    for (const f of faces) {
      // 4 corner brackets (khong ve full rectangle)
      ctx.strokeStyle = "#00B7E9";
      const cornerLen = Math.max(8, Math.min(14, f.w / 4, f.h / 4));
      drawCornerBrackets(ctx, f.x, f.y, f.w, f.h, cornerLen);
      // label background
      const label = faceLabels[f.id];
      if (label) {
        const text = label;
        const tw = ctx.measureText(text).width;
        const padX = 8, padY = 4;
        const lx = f.x;
        const ly = Math.max(0, f.y - 24);
        const lw = tw + padX * 2;
        const lh = 22;
        ctx.fillStyle = "#0D3B42"; // brand-teal dark
        ctx.fillRect(lx, ly, lw, lh);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, lx + padX, ly + lh / 2);
      } else {
        // confidence score khi chua match
        const text = `${Math.round(f.score * 100)}%`;
        const tw = ctx.measureText(text).width;
        const padX = 8;
        const lx = f.x;
        const ly = Math.max(0, f.y - 22);
        ctx.fillStyle = "rgba(13, 59, 66, 0.85)";
        ctx.fillRect(lx, ly, tw + padX * 2, 20);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, lx + padX, ly + 10);
      }
    }
  }, [faces, faceLabels, cam.videoRef]);

  // cleanup canvas khi unmount
  useEffect(() => () => clearTimeout(detectLoopRef.current), []);

  const nextGuest = useCallback(() => {
    clearNextTimer();
    setResult(null);
    setFaceLabels({});
    setStatusText("Đang chờ khách");
    setPaused(false);
  }, []);

  const scheduleNext = useCallback((delay = 2000) => {
    clearNextTimer();
    nextTimerRef.current = setTimeout(() => {
      nextTimerRef.current = null;
      nextGuest();
    }, delay);
  }, [nextGuest]);

  const confirm = async (feedback: "correct" | "wrong") => {
    if (!result?.guest) return;
    const res: RecognizeResult = await api("/checkin/confirm", {
      method: "POST",
      body: JSON.stringify({
        workshop_id: workshopId, guest_id: result.guest.id,
        log_id: result.log_id, feedback, similarity: result.similarity,
      }),
    });
    setResult(res);
    setStatusText(feedback === "wrong" ? "Đã ghi nhận sai khách" : "Đã check-in");
    scheduleNext();
  };

  const manualCheckin = async (guestId: string) => {
    const res: RecognizeResult = await api("/checkin/manual", {
      method: "POST",
      body: JSON.stringify({ workshop_id: workshopId, guest_id: guestId, method: "manual" }),
    });
    setResult(res);
    setSearchRes([]);
    setQuery("");
    setStatusText("Đã check-in (thủ công)");
    scheduleNext();
  };

  const resend = async () => {
    if (!result?.guest) return;
    await api("/checkin/resend-welcome", {
      method: "POST",
      body: JSON.stringify({ workshop_id: workshopId, guest_id: result.guest.id }),
    });
    setStatusText("Đã gửi lại lời chào");
  };

  const doSearch = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) { setSearchRes([]); return; }
    const res = await api(`/search/guests?q=${encodeURIComponent(q)}&workshop_id=${workshopId}`);
    setSearchRes(res);
  };

  const g = result?.guest;
  const showConfirm = result?.decision === "confirm";

  return (
    <main className="min-h-screen bg-surface-muted p-4">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-4">
          <div>
            <div className="text-brand text-xs font-semibold tracking-widest">HI SWEETIE VIỆT NAM</div>
            <h1 className="text-xl font-bold text-brand-teal">Check-in Staff</h1>
          </div>
          <select className="border border-line rounded-sm px-3 py-2 bg-surface"
            value={workshopId} onChange={(e) => setWorkshopId(e.target.value)}>
            {workshops.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </header>

        <div className="grid md:grid-cols-2 gap-4">
          {/* Camera */}
          <div className="bg-surface rounded-md border border-line p-4">
            <div className="relative bg-black rounded-sm overflow-hidden aspect-[4/3]">
              <video ref={cam.videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
              <canvas
                ref={overlayRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
              />
              <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
                {statusText}
              </div>
              {detector.error && (
                <div className="absolute bottom-2 left-2 bg-red-600/80 text-white text-xs px-2 py-1 rounded">
                  Face detector: {detector.error}
                </div>
              )}
            </div>
            {cam.error && <div className="text-red-600 text-sm mt-2">{cam.error}</div>}
            <div className="flex flex-wrap gap-2 mt-3 items-center">
              <button onClick={recognize} disabled={busy}
                className="bg-brand text-white px-4 py-2 rounded-sm font-medium disabled:opacity-50">
                Chụp & nhận diện
              </button>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                Tự động (1.2s)
                {auto && !paused && (
                  <span className="inline-flex items-center gap-1 text-xs text-green-700">
                    <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="tabular-nums">×{autoFireCount}</span>
                  </span>
                )}
              </label>
              <button onClick={cam.switchCamera} className="border border-line px-3 py-2 rounded-sm text-sm">
                Đổi camera
              </button>
              {cam.devices.length > 1 && (
                <select className="border border-line rounded-sm px-2 py-2 text-sm"
                  value={cam.deviceId || ""} onChange={(e) => cam.selectDevice(e.target.value)}>
                  {cam.devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
                </select>
              )}
            </div>

            {/* Manual search */}
            <div className="mt-4">
              <input value={query} onChange={(e) => doSearch(e.target.value)}
                placeholder="Tìm thủ công: tên / SĐT / công ty"
                className="w-full border border-line rounded-sm px-3 py-2" />
              {searchRes.length > 0 && (
                <div className="mt-2 border border-line rounded-sm divide-y divide-line max-h-60 overflow-auto">
                  {searchRes.map((s) => (
                    <div key={s.id} className="flex items-center justify-between p-2 text-sm">
                      <div>
                        <div className="font-medium">{s.full_name}</div>
                        <div className="text-muted text-xs">{s.company} · {maskPhone(s.phone)}</div>
                      </div>
                      <button onClick={() => manualCheckin(s.id)}
                        className="bg-brand-teal text-white px-3 py-1 rounded-sm text-xs">
                        Check-in
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Guest card */}
          <div className="bg-surface rounded-md border border-line p-4">
            {!g && <div className="text-muted text-center py-20">{result?.message || "Chưa có kết quả"}</div>}
            {g && (
              <div>
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-brand-teal">{g.full_name}</h2>
                  <span className={`text-xs px-2 py-1 rounded ${
                    g.checkin_status === "checked_in" ? "bg-success/20 text-success" : "bg-surface-muted text-muted"
                  }`}>{g.checkin_status}</span>
                </div>
                <div className="mt-2 text-sm space-y-1 text-ink">
                  {g.company && <div><span className="text-muted">Công ty:</span> {g.company}</div>}
                  {g.role_title && <div><span className="text-muted">Vai trò:</span> {g.role_title}</div>}
                  {g.guest_type && <div><span className="text-muted">Loại khách:</span> {g.guest_type}</div>}
                  {g.phone && <div><span className="text-muted">SĐT:</span> {maskPhone(g.phone)}</div>}
                  {g.note && <div><span className="text-muted">Ghi chú:</span> {g.note}</div>}
                  {result?.similarity != null && (
                    <div><span className="text-muted">Độ khớp:</span> {(result.similarity * 100).toFixed(1)}%</div>
                  )}
                </div>
                <div className="mt-3 p-2 bg-surface-muted rounded-sm text-sm">{result?.message}</div>

                <div className="flex flex-wrap gap-2 mt-4">
                  {showConfirm && (
                    <>
                      <button onClick={() => confirm("correct")}
                        className="bg-brand text-white px-4 py-2 rounded-sm font-medium">Xác nhận check-in</button>
                      <button onClick={() => confirm("wrong")}
                        className="border border-red-400 text-red-600 px-4 py-2 rounded-sm">Sai khách</button>
                    </>
                  )}
                  <button onClick={resend} className="border border-line px-4 py-2 rounded-sm">Gửi lại lời chào</button>
                  <button onClick={nextGuest}
                    className="bg-brand-teal text-white px-4 py-2 rounded-sm font-medium">Khách tiếp theo</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
