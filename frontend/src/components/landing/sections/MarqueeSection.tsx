"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { LandingImage } from "../types";

interface MarqueeSectionProps {
  images: LandingImage[];
}

function tiles(images: LandingImage[]) {
  return [0, 1, 2].flatMap((copy) =>
    images.map((image, index) => (
      <img
        key={`${copy}-${index}`}
        className="ws-marquee-tile"
        src={image.url}
        alt={copy === 0 ? image.alt || "" : ""}
        width={420}
        height={270}
        loading="lazy"
        aria-hidden={copy > 0 ? "true" : undefined}
      />
    )),
  );
}

export default function MarqueeSection({ images }: MarqueeSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const [sectionTop, setSectionTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const measure = () => {
      const el = sectionRef.current;
      if (!el) return;
      setSectionTop(el.getBoundingClientRect().top + window.scrollY);
      setViewportHeight(window.innerHeight);
    };
    measure();
    window.addEventListener("resize", measure);
    const timer = window.setTimeout(measure, 800);
    return () => {
      window.removeEventListener("resize", measure);
      window.clearTimeout(timer);
    };
  }, []);

  const offset = useTransform(scrollY, (value) =>
    viewportHeight ? (value - sectionTop + viewportHeight) * 0.3 - 200 : -200,
  );
  const offsetNeg = useTransform(offset, (value) => -value);

  // Keep both animated rows populated when a project provides a compact asset
  // set. The tile helper repeats each row three times so shorter sets still
  // fill the track without changing the visual density of the marquee.
  const balancedImages =
    images.length > 1 && images.length % 2 === 1 ? [...images, images[0]] : images;
  const midpoint = Math.ceil(balancedImages.length / 2);
  const rowOne = balancedImages.slice(0, midpoint);
  const rowTwo = balancedImages.slice(midpoint);
  const secondRow = rowTwo.length ? rowTwo : rowOne;

  return (
    <section id="marquee" className="ws-marquee" ref={sectionRef}>
      <motion.div className="ws-marquee-row" style={reduce ? undefined : { x: offset }}>
        {tiles(rowOne)}
      </motion.div>
      <motion.div className="ws-marquee-row" style={reduce ? undefined : { x: offsetNeg }}>
        {tiles(secondRow)}
      </motion.div>
    </section>
  );
}
