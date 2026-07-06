"use client";
import { useEffect, useState } from "react";

/**
 * Hook detect viewport mobile.
 * - Ngưỡng mặc định 768px (breakpoint `md` của Tailwind).
 * - Trả `null` khi SSR / lần render đầu (chưa đo được) → caller nên coi như desktop.
 * - Set giá trị ngay trong effect đầu tiên rồi lắng nghe `change` để tránh layout shift.
 */
export function useIsMobile(breakpoint = 768): boolean | null {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [breakpoint]);

  return isMobile;
}
