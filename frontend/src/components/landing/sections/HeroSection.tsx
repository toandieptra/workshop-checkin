"use client";

import { Calendar, MapPin, MonitorSmartphone } from "lucide-react";
import { useEffect, useRef } from "react";
import FadeIn from "../FadeIn";
import Magnet from "../Magnet";
import RegistrationButton from "../RegistrationButton";
import type { LandingHero } from "../types";

export interface HeroMeta {
  date?: string;
  time?: string;
  location?: string;
  format?: string;
}

interface HeroSectionProps {
  hero: LandingHero;
  meta: HeroMeta;
  onRegister: () => void;
}

export default function HeroSection({ hero, meta, onRegister }: HeroSectionProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Fit tiêu đề vào đúng chiều rộng khả dụng (không cắt chữ, không tràn ngang).
  // Dưới 700px cho phép xuống dòng theo CSS thay vì thu nhỏ.
  useEffect(() => {
    const fit = () => {
      const el = headingRef.current;
      const wrapper = el?.parentElement;
      if (!el || !wrapper) return;
      el.style.fontSize = "";
      if (window.innerWidth <= 700) return;
      const available = wrapper.clientWidth;
      const natural = el.scrollWidth;
      if (!available || !natural || natural <= available) return;
      const current = parseFloat(window.getComputedStyle(el).fontSize);
      if (!Number.isFinite(current)) return;
      const next = Math.floor(current * (available / natural) * 100) / 100;
      el.style.fontSize = `${next}px`;
    };
    fit();
    document.fonts?.ready?.then(fit).catch(() => {});
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [hero.displayTitle]);

  const timeLabel = [meta.date, meta.time].filter(Boolean).join(" · ");

  return (
    <section id="hero" className="ws-hero">
      <FadeIn delay={0} y={-20}>
        <nav className="ws-hero-nav" aria-label="Menu chính">
          <a href="#about">Giới thiệu</a>
          <a href="#program">Nội dung</a>
          <a href="#highlights">Điểm nổi bật</a>
          <a href="#register">Đăng ký</a>
        </nav>
      </FadeIn>

      <div className="ws-hero-heading-wrap">
        <FadeIn delay={0.15} y={40}>
          <h1 ref={headingRef} className="ws-hero-heading ws-gradient-text">
            {hero.displayTitle}
          </h1>
        </FadeIn>
      </div>

      <div className="ws-hero-visual">
        <FadeIn delay={0.6} y={30}>
          <Magnet className="ws-hero-magnet" padding={150} strength={3}>
            <img
              className="ws-hero-image"
              src={hero.image.url}
              alt={hero.image.alt || ""}
              width={1024}
              height={1024}
              fetchPriority="high"
            />
          </Magnet>
        </FadeIn>
      </div>

      <div className="ws-hero-bottom">
        <FadeIn delay={0.35} y={20}>
          <p className="ws-hero-tagline">{hero.tagline}</p>
          <div className="ws-hero-meta">
            {timeLabel && (
              <span className="ws-hero-meta-item">
                <Calendar aria-hidden="true" /> {timeLabel}
              </span>
            )}
            {meta.location && (
              <span className="ws-hero-meta-item">
                <MapPin aria-hidden="true" /> {meta.location}
              </span>
            )}
            {meta.format && (
              <span className="ws-hero-meta-item">
                <MonitorSmartphone aria-hidden="true" /> {meta.format}
              </span>
            )}
          </div>
        </FadeIn>
        <FadeIn delay={0.5} y={20}>
          <RegistrationButton label={hero.ctaLabel} onClick={onRegister} />
        </FadeIn>
      </div>
    </section>
  );
}
