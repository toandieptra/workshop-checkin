"use client";

import type { ReactNode } from "react";
import type { HeroMeta } from "./HeroSection";
import AnimatedText from "../AnimatedText";
import FadeIn from "../FadeIn";
import RegistrationButton from "../RegistrationButton";
import type { LandingAbout } from "../types";

interface AboutSectionProps {
  about: LandingAbout;
  onRegister: () => void;
  registration?: ReactNode;
  meta: HeroMeta;
}

const DECOR_POSITIONS = ["ws-decor-tl", "ws-decor-bl", "ws-decor-tr", "ws-decor-br"];
const DECOR_DELAYS = [0.1, 0.25, 0.15, 0.3];
const DECOR_X = [-80, -80, 80, 80];

export default function AboutSection({
  about,
  onRegister,
  registration,
  meta,
}: AboutSectionProps) {
  return (
    <section id="about" className={`ws-about${registration ? " ws-about-with-form" : ""}`}>
      {about.decorImages.slice(0, 4).map((image, index) => (
        <FadeIn
          key={`${index}-${image.url}`}
          className={`ws-about-decor ${DECOR_POSITIONS[index]}`}
          delay={DECOR_DELAYS[index]}
          x={DECOR_X[index]}
          y={0}
          duration={0.9}
        >
          <img src={image.url} alt={image.alt || ""} loading="lazy" aria-hidden="true" />
        </FadeIn>
      ))}

      <div className="ws-about-inner">
        <div className="ws-about-copy">
        {registration && <p className="ws-about-eyebrow">KẾT NỐI · TRẢI NGHIỆM · SÁNG TẠO</p>}
        <FadeIn y={40}>
          <h2 className="ws-section-title ws-gradient-text">{about.heading}</h2>
        </FadeIn>
        <div className="ws-about-text-wrap">
          <AnimatedText text={about.description} className="ws-about-text" />
        </div>
        {!registration && <div className="ws-about-cta">
          <FadeIn y={20}>
            <RegistrationButton label="Giữ chỗ tham gia" onClick={onRegister} />
          </FadeIn>
        </div>}

        {registration && (
          <dl className="ws-about-event">
            {(meta.date || meta.time) && <div><dt>Thời gian</dt><dd>{[meta.date, meta.time].filter(Boolean).join(" · ")}</dd></div>}
            {meta.location && <div><dt>Địa điểm</dt><dd>{meta.location}</dd></div>}
          </dl>
        )}
        </div>
        {registration && (
          <div id="register" tabIndex={-1} className="ws-about-registration" aria-label="Đăng ký tham gia workshop">
            <div className="ws-about-registration-head">
              <span>ĐĂNG KÝ THAM GIA WORKSHOP</span>
              <small>Điền thông tin để giữ chỗ và nhận xác nhận từ ban tổ chức.</small>
            </div>
            {registration}
          </div>
        )}
      </div>
    </section>
  );
}
