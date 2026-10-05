"use client";

import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { useMemo, useRef } from "react";

interface AnimatedTextProps {
  text: string;
  className?: string;
}

function splitGraphemes(text: string): string[] {
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: string },
      ) => { segment: (input: string) => Iterable<{ segment: string }> };
    }
  ).Segmenter;
  if (Segmenter) {
    try {
      const segmenter = new Segmenter("vi", { granularity: "grapheme" });
      return Array.from(segmenter.segment(text), (part) => part.segment);
    } catch {
      // fall through
    }
  }
  return Array.from(text);
}

function Char({
  char,
  progress,
  start,
  end,
}: {
  char: string;
  progress: MotionValue<number>;
  start: number;
  end: number;
}) {
  const opacity = useTransform(progress, [start, end], [0.2, 1]);
  return <motion.span style={{ opacity }}>{char === " " ? "\u00A0" : char}</motion.span>;
}

/**
 * Character-by-character scroll reveal: mỗi ký tự chuyển opacity 0.2 → 1
 * theo tiến độ scroll của đoạn văn (không phải theo thời gian).
 */
export default function AnimatedText({ text, className }: AnimatedTextProps) {
  const ref = useRef<HTMLParagraphElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.8", "end 0.2"],
  });
  const chars = useMemo(() => splitGraphemes(text), [text]);
  const total = chars.length || 1;

  if (reduce) {
    return <p className={className}>{text}</p>;
  }

  return (
    <>
      <p ref={ref} className={className} aria-hidden="true">
        {chars.map((char, index) => {
          const start = (index / total) * 0.9;
          const end = Math.min(1, start + 0.1 + 1 / total);
          return (
            <Char key={`${index}-${char}`} char={char} progress={scrollYProgress} start={start} end={end} />
          );
        })}
      </p>
      <span className="ws-sr-only">{text}</span>
    </>
  );
}
