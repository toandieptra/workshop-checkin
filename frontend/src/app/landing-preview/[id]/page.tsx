"use client";

import { Kanit } from "next/font/google";
import { useCallback, useEffect, useMemo, useState } from "react";
import AdminGate from "@/components/AdminGate";
import LandingRenderer from "@/components/landing/LandingRenderer";
import "@/components/landing/landing.css";
import {
  buildDefaultContent,
  normalizeLandingContent,
  type LandingContent,
} from "@/components/landing/types";
import { AuthProvider } from "@/contexts/AuthContext";
import { AdminLoadingProvider } from "@/contexts/AdminLoadingContext";
import {
  getWorkshop,
  getWorkshopLandingContent,
  type WorkshopAdmin,
} from "@/lib/api";
import { formatEventDate } from "@/lib/date-format";

const kanit = Kanit({
  subsets: ["latin", "vietnamese"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
  variable: "--font-kanit",
});

export const dynamic = "force-dynamic";

function PreviewContent({ id }: { id: string }) {
  const [workshop, setWorkshop] = useState<WorkshopAdmin | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [live, setLive] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([getWorkshop(id), getWorkshopLandingContent(id)])
      .then(([workshopData, contentData]) => {
        if (!active) return;
        setWorkshop(workshopData);
        setDraft(contentData.draft_content ?? null);
      })
      .catch(() => active && setError("Không tải được nội dung xem trước."));
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "landing-preview-content") {
        setLive(
          event.data.content && typeof event.data.content === "object"
            ? (event.data.content as Record<string, unknown>)
            : null,
        );
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Nền tối cho iframe (tránh lộ màu body của app khi overscroll)
  useEffect(() => {
    const body = document.body;
    const prevBg = body.style.background;
    body.style.background = "#0C0C0C";
    return () => {
      body.style.background = prevBg;
    };
  }, []);

  const content = useMemo<LandingContent | null>(() => {
    if (!workshop) return null;
    const defaults = buildDefaultContent({
      name: workshop.name,
      eventDate: workshop.event_date,
      eventTime: workshop.event_time,
      location: workshop.location,
    });
    return normalizeLandingContent(live ?? draft, defaults);
  }, [workshop, draft, live]);

  const onRegister = useCallback(() => {
    window.parent?.postMessage({ type: "landing-preview-register" }, window.location.origin);
  }, []);

  if (error) {
    return <div className="p-6 text-sm text-muted">{error}</div>;
  }

  if (!workshop || !content) {
    return <div className="p-6 text-sm text-muted">Đang tải nội dung xem trước…</div>;
  }

  const meta = {
    date: workshop.event_date ? formatEventDate(workshop.event_date) : "",
    time: workshop.event_time ? workshop.event_time.slice(0, 5) : "",
    location: workshop.location || "",
    format: "",
  };

  return (
    <div className={`ws-landing ${kanit.variable}`}>
      <LandingRenderer content={content} meta={meta} onRegister={onRegister} />
    </div>
  );
}

/**
 * Preview nội dung landing page cho builder (chạy trong iframe, không có admin nav).
 * - Mặc định hiển thị bản nháp đã lưu.
 * - Builder đẩy nội dung đang sửa qua postMessage để preview cập nhật trực tiếp.
 */
export default function LandingPreviewPage({ params }: { params: { id: string } }) {
  return (
    <AdminLoadingProvider>
      <AuthProvider>
        <AdminGate>
          <PreviewContent id={params.id} />
        </AdminGate>
      </AuthProvider>
    </AdminLoadingProvider>
  );
}
