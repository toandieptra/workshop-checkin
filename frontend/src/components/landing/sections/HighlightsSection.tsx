"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useRef, type CSSProperties } from "react";
import DetailsButton from "../DetailsButton";
import FadeIn from "../FadeIn";
import RegistrationButton from "../RegistrationButton";
import type { LandingHighlightCard, LandingHighlights } from "../types";
import type { HeroMeta } from "./HeroSection";

interface HighlightsSectionProps {
  highlights: LandingHighlights;
  meta: HeroMeta;
  onRegister: () => void;
}

function StickyCard({
  card,
  index,
  total,
  onRegister,
}: {
  card: LandingHighlightCard;
  index: number;
  total: number;
  onRegister: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: wrapRef,
    offset: ["start 72%", "end 72%"],
  });
  const targetScale = 1 - (total - 1 - index) * 0.03;
  const scale = useTransform(scrollYProgress, [0, 1], [1, targetScale]);

  const style = (
    reduce
      ? { zIndex: index + 1 }
      : {
          scale,
          zIndex: index + 1,
          transformOrigin: "top center",
          "--stack-offset": `${index * 28}px`,
        }
  ) as CSSProperties;

  const [first, second, third] = card.images;
  const hasSingleImage = Boolean(first && !second && !third);

  return (
    <div ref={wrapRef} className="ws-stack-item">
      <motion.article className="ws-highlight-card" style={style}>
        <div className="ws-card-top">
          <span className="ws-card-num" aria-hidden="true">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="ws-card-copy">
            <p className="ws-card-kicker">{card.category}</p>
            <h3 className="ws-card-title">{card.title}</h3>
            {card.description && <p className="ws-card-desc">{card.description}</p>}
          </div>
          <DetailsButton
            label={card.ctaLabel}
            href={card.ctaHref || undefined}
            onClick={card.ctaHref ? undefined : onRegister}
          />
        </div>
        {hasSingleImage ? (
          <div className="ws-card-grid ws-card-grid-single">
            <img
              className="ws-card-img ws-card-img-single"
              src={first.url}
              alt={first.alt || ""}
              loading="lazy"
              width={1280}
              height={720}
            />
          </div>
        ) : (
          <div className="ws-card-grid">
            <div className="ws-card-col">
              {first && (
                <img
                  className="ws-card-img"
                  src={first.url}
                  alt={first.alt || ""}
                  loading="lazy"
                  width={640}
                  height={480}
                />
              )}
              {second && (
                <img
                  className="ws-card-img"
                  src={second.url}
                  alt={second.alt || ""}
                  loading="lazy"
                  width={640}
                  height={720}
                />
              )}
            </div>
            {third && (
              <img
                className="ws-card-img ws-card-img-tall"
                src={third.url}
                alt={third.alt || ""}
                loading="lazy"
                width={640}
                height={1024}
              />
            )}
          </div>
        )}
      </motion.article>
    </div>
  );
}

export default function HighlightsSection({ highlights, meta, onRegister }: HighlightsSectionProps) {
  // Keep the original sticky-card layout while allowing the configured fourth
  // benefit to appear in the section.
  const cards = highlights.cards.slice(0, 4);
  const timeLabel = [meta.date, meta.time].filter(Boolean).join(" · ");
  const reminder = [timeLabel, meta.location].filter(Boolean).join(" · ");
  const contactLine = [
    highlights.contact.organizer,
    highlights.contact.email,
    highlights.contact.phone,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section id="highlights" className="ws-highlights">
      <FadeIn y={40}>
        <h2 className="ws-section-title ws-gradient-text">{highlights.heading}</h2>
      </FadeIn>

      {highlights.outcomes.length > 0 && (
        <FadeIn y={24}>
          <div className="ws-highlight-outcomes" aria-labelledby="highlights-outcomes-title">
            <h3 id="highlights-outcomes-title" className="ws-highlight-outcomes-title">
              Gợi ý ứng dụng sau workshop
            </h3>
            <ul className="ws-highlight-outcomes-list">
              {highlights.outcomes.slice(0, 4).map((outcome) => (
                <li key={outcome}>{outcome}</li>
              ))}
            </ul>
          </div>
        </FadeIn>
      )}

      <div className="ws-stack">
        {cards.map((card, index) => (
          <StickyCard
            key={`${index}-${card.title}`}
            card={card}
            index={index}
            total={cards.length}
            onRegister={onRegister}
          />
        ))}
      </div>

      <div className="ws-end">
        <FadeIn y={20}>
          <RegistrationButton label={highlights.ctaLabel} onClick={onRegister} />
        </FadeIn>
        {reminder && <p className="ws-end-meta">{reminder}</p>}
        {contactLine && <p className="ws-end-contact">{contactLine}</p>}
      </div>
    </section>
  );
}
