"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface MagnetProps {
  children: ReactNode;
  className?: string;
  padding?: number;
  strength?: number;
}

/**
 * Mouse-following magnetic interaction.
 * Chỉ hoạt động trên thiết bị có con trỏ chính xác và không bật reduced-motion.
 */
export default function Magnet({
  children,
  className,
  padding = 150,
  strength = 3,
}: MagnetProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const hover = window.matchMedia("(hover: hover)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setEnabled(fine && hover && !reduce);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    let active = false;

    const reset = () => {
      if (!active) return;
      active = false;
      inner.style.transition = "transform 0.6s ease-in-out";
      inner.style.transform = "translate3d(0, 0, 0)";
    };

    const onMove = (event: PointerEvent) => {
      const rect = outer.getBoundingClientRect();
      const within =
        event.clientX >= rect.left - padding &&
        event.clientX <= rect.right + padding &&
        event.clientY >= rect.top - padding &&
        event.clientY <= rect.bottom + padding;
      if (!within) {
        reset();
        return;
      }
      active = true;
      const x = (event.clientX - (rect.left + rect.width / 2)) / strength;
      const y = (event.clientY - (rect.top + rect.height / 2)) / strength;
      inner.style.transition = "transform 0.3s ease-out";
      inner.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", reset);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", reset);
      window.removeEventListener("blur", reset);
    };
  }, [enabled, padding, strength]);

  return (
    <div ref={outerRef} className={className}>
      <div ref={innerRef} style={{ willChange: "transform" }}>
        {children}
      </div>
    </div>
  );
}
