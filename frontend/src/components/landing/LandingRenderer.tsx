"use client";

import type { ReactNode } from "react";
import AboutSection from "./sections/AboutSection";
import HeroSection, { type HeroMeta } from "./sections/HeroSection";
import HighlightsSection from "./sections/HighlightsSection";
import MarqueeSection from "./sections/MarqueeSection";
import ProgramSection from "./sections/ProgramSection";
import type { LandingContent } from "./types";

interface LandingRendererProps {
  content: LandingContent;
  meta: HeroMeta;
  onRegister: () => void;
  registration?: ReactNode;
}

/**
 * Renderer dùng chung cho trang công khai và preview trong builder.
 * Nhận nội dung đã chuẩn hoá (LandingContent) — không tự fetch dữ liệu.
 */
export default function LandingRenderer({
  content,
  meta,
  onRegister,
  registration,
}: LandingRendererProps) {
  return (
    <>
      <HeroSection hero={content.hero} meta={meta} onRegister={onRegister} />
      <MarqueeSection images={content.marquee.images} />
      <AboutSection
        about={content.about}
        onRegister={onRegister}
        registration={registration}
        meta={meta}
      />
      <ProgramSection program={content.program} />
      <HighlightsSection highlights={content.highlights} meta={meta} onRegister={onRegister} />
    </>
  );
}
