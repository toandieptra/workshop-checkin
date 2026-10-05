"use client";

import { Kanit } from "next/font/google";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LandingRenderer from "@/components/landing/LandingRenderer";
import "@/components/landing/landing.css";
import {
  buildDefaultContent,
  normalizeLandingContent,
  type LandingContent,
} from "@/components/landing/types";
import { getWorkshopLandingPage, type WorkshopLandingPagePublic } from "@/lib/api";
import { formatEventDate } from "@/lib/date-format";

const kanit = Kanit({
  subsets: ["latin", "vietnamese"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
  variable: "--font-kanit",
});

export const dynamic = "force-dynamic";

export default function WorkshopLandingPage({ params }: { params: { slug: string } }) {
  const [landing, setLanding] = useState<WorkshopLandingPagePublic | null>(null);
  const [error, setError] = useState("");
  const [formHeight, setFormHeight] = useState(700);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let active = true;
    getWorkshopLandingPage(params.slug)
      .then((data) => active && setLanding(data))
      .catch(() => active && setError("Landing page không tồn tại hoặc chưa được tạo."));
    return () => {
      active = false;
    };
  }, [params.slug]);

  // Nền tối cho toàn trang khi ở landing (tránh lộ màu body khi overscroll)
  useEffect(() => {
    const body = document.body;
    const prevBg = body.style.background;
    const prevColor = body.style.color;
    const prevScrollBehavior = document.documentElement.style.scrollBehavior;
    body.style.background = "#0C0C0C";
    body.style.color = "#D7E2EA";
    document.documentElement.style.scrollBehavior = "smooth";
    return () => {
      body.style.background = prevBg;
      body.style.color = prevColor;
      document.documentElement.style.scrollBehavior = prevScrollBehavior;
    };
  }, []);

  // Resize the inline form as validation messages and confirmation change its height.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === "registration-form-height") {
        const height = Number(event.data.height);
        if (Number.isFinite(height)) setFormHeight(Math.max(280, Math.min(6000, height)));
        return;
      }

    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const content = useMemo<LandingContent | null>(() => {
    if (!landing) return null;
    const defaults = buildDefaultContent({
      name: landing.name,
      eventDate: landing.event_date,
      eventTime: landing.event_time,
      location: landing.location,
    });
    return normalizeLandingContent(landing.landing_content ?? null, defaults);
  }, [landing]);

  useEffect(() => {
    if (!content) return;
    const prevTitle = document.title;
    document.title = content.seo.title || `${landing?.name ?? "Workshop"} — Workshop`;
    return () => {
      document.title = prevTitle;
    };
  }, [content, landing]);

  const openRegister = useCallback(() => {
    const target = document.getElementById("register");
    target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    target?.focus({ preventScroll: true });
  }, []);

  if (error) {
    return (
      <main className={`ws-landing ${kanit.variable}`}>
        <div className="ws-state">
          <p className="ws-state-kicker">Không thể mở trang</p>
          <h1 className="ws-state-title">Landing page chưa khả dụng</h1>
          <p className="ws-state-text">{error}</p>
        </div>
      </main>
    );
  }

  if (!landing || !content) {
    return (
      <main className={`ws-landing ${kanit.variable}`} aria-busy="true">
        <div className="ws-state">
          <p className="ws-state-text">Đang tải thông tin workshop…</p>
        </div>
      </main>
    );
  }

  if (!landing.landing_content) {
    return (
      <main className={`ws-landing ${kanit.variable}`}>
        <div className="ws-state">
          <p className="ws-state-kicker">Workshop</p>
          <h1 className="ws-state-title">{landing.name}</h1>
          <p className="ws-state-text">
            Nội dung landing page chưa được xuất bản. Vui lòng quay lại sau hoặc liên hệ ban tổ chức.
          </p>
        </div>
      </main>
    );
  }

  const registrationOpen = landing.status === "published" && landing.registration_form.is_active;
  const registerUrl = `/register/${landing.registration_form.token}?workshop=${encodeURIComponent(landing.id)}&embedded=1&theme=landing`;
  const meta = {
    date: landing.event_date ? formatEventDate(landing.event_date) : "",
    time: landing.event_time ? landing.event_time.slice(0, 5) : "",
    location: landing.location || "",
    format: "",
  };

  return (
    <main className={`ws-landing ${kanit.variable}`}>
      <LandingRenderer
        content={content}
        meta={meta}
        onRegister={openRegister}
        registration={registrationOpen ? (
          <iframe
            ref={iframeRef}
            title={`Form đăng ký ${landing.name}`}
            src={registerUrl}
            style={{ width: "100%", height: formHeight, border: 0, display: "block" }}
          />
        ) : (
          <div className="ws-registration-closed" role="status">
            <h3>Workshop hiện chưa nhận đăng ký</h3>
            <p>Vui lòng liên hệ ban tổ chức để được hỗ trợ.</p>
          </div>
        )}
      />

    </main>
  );
}
