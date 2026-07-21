"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWebSocket } from "@/hooks/useWebSocket";
import { api, getWorkshopBySlug } from "@/lib/api";
import QrDisplay from "@/components/QrDisplay";
import Link from "next/link";

// Phụ thuộc hoàn toàn vào query param `w` ở runtime nên không prerender.
export const dynamic = "force-dynamic";

const WELCOME_MS = 10000;

interface Workshop {
  id: string;
  name: string;
  slug: string;
  event_date?: string;
  location?: string;
}

/** Định dạng ngày về dạng dd/mm/yyyy. Trả về "—" nếu không hợp lệ. */
function formatEventDate(v?: string): string {
  if (!v) return "—";
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export default function WelcomePage() {
  return (
    <Suspense
      fallback={
        <main className="fixed inset-0 flex items-center justify-center bg-[#0D3B42]">
          <div className="text-white/80 text-lg">Đang tải…</div>
        </main>
      }
    >
      <WelcomeInner />
    </Suspense>
  );
}

function WelcomeInner() {
  const sp = useSearchParams();
  const slug = sp.get("w") || "";

  const [workshop, setWorkshop] = useState<Workshop | null>(null);
  const [welcome, setWelcome] = useState<{ name: string; message: string } | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "notfound">("loading");
  const timerRef = useRef<any>(null);

  // Tải workshop theo slug.
  useEffect(() => {
    if (!slug) {
      setLoadState("notfound");
      return;
    }
    (async () => {
      try {
        const w = await getWorkshopBySlug(slug);
        if (!w || !w.id) {
          setLoadState("notfound");
          return;
        }
        setWorkshop(w);
        setLoadState("ok");
      } catch {
        setLoadState("notfound");
      }
    })();
  }, [slug]);

  // WebSocket: chỉ nhận event đúng workshop hiện tại
  const wsWorkshopId = workshop?.id || "";
  const { connected } = useWebSocket((data: any) => {
    if (data?.type === "welcome" && data.workshop_id && data.workshop_id === wsWorkshopId) {
      if (data.display_name) {
        setWelcome({ name: data.display_name, message: data.display_message || "" });
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setWelcome(null), WELCOME_MS);
      }
    }
  });

  // Polling fallback cho latest welcome, lọc theo workshop_id.
  useEffect(() => {
    if (!workshop) return;
    const wid = workshop.id;
    if (connected) return;
    let lastEventId: string | null = null;
    let isInitial = true;
    const poll = async () => {
      try {
        const res = await api<any>(`/checkin/welcome/latest?workshop_id=${encodeURIComponent(wid)}`);
        if (res && res.id) {
          if (isInitial) {
            isInitial = false;
            lastEventId = res.id;
            const diff = Date.now() - new Date(res.created_at).getTime();
            if (diff < WELCOME_MS) {
              setWelcome({ name: res.display_name, message: res.display_message || "" });
              clearTimeout(timerRef.current);
              timerRef.current = setTimeout(() => setWelcome(null), WELCOME_MS);
            }
            return;
          }
          if (res.id !== lastEventId) {
            lastEventId = res.id;
            setWelcome({ name: res.display_name, message: res.display_message || "" });
            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setWelcome(null), WELCOME_MS);
          }
        }
      } catch (err) {
        console.error("Failed to poll latest welcome:", err);
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [connected, workshop]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Khi có welcome đang hiện → ưu tiên hiện welcome che hết QR
  if (welcome) {
    return (
      <main className="fixed inset-0 flex flex-col items-center justify-center text-center overflow-hidden bg-[#0D3B42]">
        <div className="max-w-[92vw] px-8 animate-[fadeIn_.6s_ease] motion-reduce:animate-none">
          <div className="text-white/80 text-2xl md:text-3xl mb-6 tracking-widest">
            CHÀO MỪNG ANH/CHỊ
          </div>
          <h1 className="max-w-[90vw] break-words text-white text-[clamp(2.5rem,8vw,6rem)] font-bold mb-8 leading-tight">
            {welcome.name}
          </h1>
          <div className="text-white text-3xl md:text-4xl font-medium mb-4">
            Đến với Workshop
          </div>
          <div className="whitespace-pre-line text-white/85 text-xl md:text-2xl">
            {welcome.message || "Hi Sweetie Việt Nam rất vui được đón tiếp anh/chị"}
          </div>
        </div>
        <style>{`@keyframes fadeIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}`}</style>
      </main>
    );
  }

  // Không slug hoặc slug không tồn tại → render nội dung not-found inline.
  if (loadState === "notfound") {
    return (
      <main className="fixed inset-0 flex items-center justify-center p-6 bg-[#0D3B42]">
        <div className="bg-white/95 rounded-xl p-8 shadow-xl text-center max-w-md w-full">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-cyan-bg text-brand-teal" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg></div>
          <h1 className="text-xl font-bold text-brand-teal mb-2">
            Không tìm thấy trang Welcome
          </h1>
          <p className="text-sm text-muted mb-5">
            Trang Welcome cần một workshop hợp lệ. Vui lòng mở URL dạng
            <br />
            <code className="text-brand-teal font-mono">/welcome?w=&lt;slug&gt;</code>
            <br />
            do quản trị viên cung cấp.
          </p>
          <Link
            href="/"
            className="inline-block bg-brand text-brand-teal px-4 py-2 rounded-md text-sm font-semibold"
          >
            ← Về trang chủ
          </Link>
        </div>
      </main>
    );
  }

  // Đang tải workshop → render nhẹ
  if (loadState !== "ok" || !workshop) {
    return (
      <main className="fixed inset-0 flex items-center justify-center bg-[#0D3B42]">
        <div className="text-white/80 text-lg">Đang tải…</div>
      </main>
    );
  }

  // Màn hình chờ → giao diện theo mẫu checkin-welcome.html
  return (
    <div className="welcome-root">
      <div className="welcome-backdrop" aria-hidden="true" />
      <div className="welcome-leaves" aria-hidden="true">
        <svg style={{ top: "8%", left: "6%", width: 90, opacity: 0.7 }} viewBox="0 0 64 64" fill="none">
          <path d="M8 56 C 16 24, 36 12, 60 8 C 56 32, 44 52, 8 56 Z" fill="rgba(168,216,224,0.35)" />
          <path d="M12 52 C 22 32, 38 22, 56 14" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" fill="none" />
        </svg>
        <svg style={{ top: "18%", right: "7%", width: 70, opacity: 0.5, transform: "rotate(28deg)" }} viewBox="0 0 64 64" fill="none">
          <path d="M8 56 C 16 24, 36 12, 60 8 C 56 32, 44 52, 8 56 Z" fill="rgba(201,168,76,0.3)" />
          <path d="M12 52 C 22 32, 38 22, 56 14" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" fill="none" />
        </svg>
        <svg style={{ bottom: "18%", left: "10%", width: 60, opacity: 0.45, transform: "rotate(-18deg)" }} viewBox="0 0 64 64" fill="none">
          <path d="M8 56 C 16 24, 36 12, 60 8 C 56 32, 44 52, 8 56 Z" fill="rgba(168,216,224,0.4)" />
        </svg>
        <svg style={{ bottom: "24%", right: "8%", width: 80, opacity: 0.55, transform: "rotate(60deg)" }} viewBox="0 0 64 64" fill="none">
          <path d="M8 56 C 16 24, 36 12, 60 8 C 56 32, 44 52, 8 56 Z" fill="rgba(201,168,76,0.32)" />
        </svg>
      </div>

      <div className="welcome-shell">
        <main>
          <section className="welcome-hero">
            <span className="welcome-eyebrow">HI SWEETIE VIỆT NAM</span>
            <p className="welcome-hero-lead">Chào mừng anh/chị đến với</p>
            <h1 className="welcome-hero-title">
              <em>{workshop.name}</em>
            </h1>
            <p className="welcome-hero-sub">
              Cảm ơn anh/chị đã ghé qua — quét QR bên dưới để check-in. Chúc anh/chị có trải nghiệm hữu ích và nhớ giúp team hoàn thành Survey nhé.
            </p>
          </section>

          <section className="welcome-info">
            <div className="welcome-info-grid">
              <div className="welcome-info-cell">
                <span className="welcome-info-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="5" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    <circle cx="8" cy="14" r="1.2" fill="currentColor" />
                    <circle cx="12" cy="14" r="1.2" fill="currentColor" />
                    <circle cx="16" cy="14" r="1.2" fill="currentColor" />
                  </svg>
                </span>
                <div>
                  <p className="welcome-info-label">Ngày / Thời gian</p>
                  <p className="welcome-info-value">{formatEventDate(workshop.event_date)}</p>
                  <p className="welcome-info-sub">Cùng trải nghiệm cùng Hi Sweetie</p>
                </div>
              </div>

              <div className="welcome-info-cell">
                <span className="welcome-info-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13Z" stroke="currentColor" strokeWidth="1.6" />
                    <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                </span>
                <div>
                  <p className="welcome-info-label">Địa điểm</p>
                  <p className="welcome-info-value">
                    {workshop.location ? workshop.location.split(",")[0] : "—"}
                  </p>
                  <p className="welcome-info-sub">
                    {workshop.location ? workshop.location.split(",").slice(1).join(",").trim() : ""}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="welcome-qr-section">
            <div className="welcome-qr-card">
              <header className="welcome-qr-header">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M14 14h3v3M21 14v3M14 21h3M21 17v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <h2 className="welcome-qr-title">Quý khách quét QR để Check-in</h2>
              </header>

              <div className="welcome-qr-frame">
                <QrDisplay workshopSlug={workshop.slug} size={260} showUrl={false} />
              </div>
            </div>
          </section>

        </main>
      </div>

      <style>{`
        .welcome-root {
          position: fixed;
          inset: 0;
          overflow: auto;
          background: #0D3B42;
          color: #fff;
          font-family: 'Be Vietnam Pro', Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
        }
        .welcome-backdrop {
          position: fixed;
          inset: 0;
          z-index: 0;
          background:
            radial-gradient(ellipse 90% 70% at 50% 0%, #1A5F6A 0%, transparent 60%),
            radial-gradient(ellipse 60% 80% at 100% 100%, #0B5C6B 0%, transparent 55%),
            linear-gradient(180deg, #1A5F6A 0%, #0D3B42 70%, #082A30 100%);
          overflow: hidden;
          pointer-events: none;
        }
        .welcome-backdrop::before,
        .welcome-backdrop::after {
          content: "";
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.55;
          will-change: transform;
        }
        .welcome-backdrop::before {
          width: 520px; height: 520px;
          left: -120px; top: -120px;
          background: radial-gradient(circle, rgba(0,183,204,0.55), transparent 70%);
          animation: welcomeDrift 18s ease-in-out infinite alternate;
        }
        .welcome-backdrop::after {
          width: 620px; height: 620px;
          right: -180px; bottom: -160px;
          background: radial-gradient(circle, rgba(201,168,76,0.32), transparent 70%);
          animation: welcomeDrift 22s ease-in-out infinite alternate-reverse;
        }
        @keyframes welcomeDrift {
          0%   { transform: translate3d(0, 0, 0) scale(1); }
          100% { transform: translate3d(40px, -30px, 0) scale(1.08); }
        }
        .welcome-leaves {
          position: fixed;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          opacity: 0.32;
        }
        .welcome-leaves svg { position: absolute; }
        .welcome-shell {
          position: relative;
          z-index: 2;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }
        .welcome-shell main {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: clamp(48px, 8vw, 96px) 24px clamp(40px, 6vw, 72px);
        }
        .welcome-hero {
          text-align: center;
          max-width: 880px;
          margin: 0 auto;
        }
        .welcome-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 8px 16px;
          border-radius: 999px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(168,216,224,0.22);
          color: #C5E4E8;
          font-family: 'Montserrat', 'Manrope', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
          font-weight: 600;
          font-size: 12px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
        }
        .welcome-eyebrow::before {
          content: "";
          width: 6px; height: 6px;
          border-radius: 999px;
          background: #00B7CC;
          box-shadow: 0 0 12px rgba(0,183,204,0.8);
        }
        .welcome-hero-lead {
          margin: 22px 0 6px;
          font-weight: 500;
          font-size: clamp(16px, 1.6vw, 20px);
          color: #C5E4E8;
          letter-spacing: 0.02em;
        }
        .welcome-hero-title {
          margin: 0;
          font-family: 'Montserrat', 'Manrope', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
          font-weight: 800;
          line-height: 1.08;
          letter-spacing: -0.01em;
          font-size: clamp(40px, 7vw, 76px);
          background: linear-gradient(180deg, #FFFFFF 0%, #C5E4E8 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .welcome-hero-title em {
          font-style: normal;
          background: linear-gradient(135deg, #5DD6E5 0%, #C9A84C 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .welcome-hero-sub {
          margin: 18px auto 0;
          max-width: 620px;
          color: rgba(255,255,255,0.78);
          font-size: clamp(15px, 1.4vw, 17px);
          line-height: 1.65;
        }
        .welcome-info {
          margin-top: clamp(40px, 6vw, 56px);
          width: 100%;
          max-width: 1120px;
          margin-inline: auto;
        }
        .welcome-info-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: clamp(16px, 2vw, 24px);
          align-items: stretch;
        }
        @media (max-width: 720px) {
          .welcome-info-grid { grid-template-columns: 1fr; }
        }
        .welcome-info-cell {
          display: flex;
          align-items: flex-start;
          gap: clamp(14px, 1.6vw, 20px);
          min-height: 150px;
          height: 100%;
          padding: clamp(22px, 2.4vw, 30px);
          border-radius: 24px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(168,216,224,0.18);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          transition: transform 250ms ease, background 250ms ease;
        }
        .welcome-info-cell:hover {
          transform: translateY(-2px);
          background: rgba(255,255,255,0.09);
        }
        .welcome-info-icon {
          flex: 0 0 auto;
          width: 44px; height: 44px;
          border-radius: 12px;
          display: grid; place-items: center;
          background: linear-gradient(135deg, rgba(0,183,204,0.25), rgba(46,139,143,0.25));
          color: #C5E4E8;
          border: 1px solid rgba(168,216,224,0.22);
        }
        .welcome-info-icon svg { width: 22px; height: 22px; }
        .welcome-info-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #A8D8E0;
          margin: 0 0 4px;
        }
        .welcome-info-value {
          font-family: 'Montserrat', 'Manrope', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
          font-weight: 700;
          color: #fff;
          font-size: clamp(15px, 1.5vw, 18px);
          line-height: 1.35;
          margin: 0;
        }
        .welcome-info-sub {
          margin-top: 2px;
          color: rgba(255,255,255,0.7);
          font-size: 13px;
          line-height: 1.5;
        }
        .welcome-qr-section {
          margin-top: clamp(36px, 5vw, 48px);
          width: 100%;
          display: flex;
          justify-content: center;
        }
        .welcome-qr-card {
          position: relative;
          width: 100%;
          max-width: 460px;
          padding: clamp(24px, 4vw, 36px);
          border-radius: 28px;
          background: rgba(255,255,255,0.92);
          backdrop-filter: saturate(180%) blur(28px);
          -webkit-backdrop-filter: saturate(180%) blur(28px);
          border: 1px solid rgba(255,255,255,0.8);
          box-shadow:
            0 30px 80px rgba(0,0,0,0.25),
            0 0 0 1px rgba(168,216,224,0.4),
            0 0 60px rgba(0,183,204,0.18);
          text-align: center;
        }
        .welcome-qr-header {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          color: #0D3B42;
          margin-bottom: 18px;
        }
        .welcome-qr-header svg {
          width: 22px; height: 22px;
          color: #00B7CC;
        }
        .welcome-qr-title {
          margin: 0;
          font-family: 'Montserrat', 'Manrope', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
          font-weight: 700;
          font-size: clamp(15px, 1.5vw, 17px);
          letter-spacing: 0.01em;
        }
        .welcome-qr-frame {
          position: relative;
          width: clamp(220px, 50vw, 300px);
          aspect-ratio: 1 / 1;
          margin: 8px auto 4px;
          padding: 14px;
          border-radius: 22px;
          background: linear-gradient(135deg, #fff 0%, #F5FAFB 100%);
          border: 1.5px solid rgba(0,183,204,0.35);
          box-shadow:
            inset 0 0 0 1px rgba(255,255,255,1),
            0 12px 32px rgba(0,183,204,0.18);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .welcome-qr-frame > div {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          max-width: 100%;
        }
        .welcome-features {
          margin-top: clamp(28px, 4vw, 40px);
          width: 100%;
          max-width: 760px;
          margin-inline: auto;
        }
        .welcome-features-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }
        @media (max-width: 720px) {
          .welcome-features-grid { grid-template-columns: 1fr; }
        }
        .welcome-feature {
          text-align: center;
          padding: 18px 16px;
          border-radius: 20px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(168,216,224,0.14);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          transition: background 250ms ease;
        }
        .welcome-feature:hover { background: rgba(255,255,255,0.08); }
        .welcome-feature-icon {
          width: 36px; height: 36px;
          margin: 0 auto 8px;
          border-radius: 10px;
          display: grid; place-items: center;
          background: rgba(0,183,204,0.14);
          color: #C5E4E8;
          border: 1px solid rgba(168,216,224,0.22);
        }
        .welcome-feature-icon svg { width: 18px; height: 18px; }
        .welcome-feature-title {
          margin: 0 0 4px;
          font-family: 'Montserrat', 'Manrope', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
          font-weight: 700;
          font-size: 14px;
          color: #fff;
        }
        .welcome-feature-desc {
          margin: 0;
          font-size: 12.5px;
          color: rgba(255,255,255,0.66);
          line-height: 1.5;
        }
        @media (prefers-reduced-motion: reduce) {
          .welcome-backdrop::before,
          .welcome-backdrop::after,
          .welcome-leaves svg,
          .animate-pulse { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
