"use client";
import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopAdmin from "./DesktopAdmin";
import MobileAdmin from "./MobileAdmin";

/**
 * Router component cho /admin — chọn view theo viewport.
 *  - ≤ 768px: MobileAdmin (tối giản, tập trung check-in tại sự kiện).
 *  - > 768px: DesktopAdmin (UI đầy đủ).
 *
 * Trong khi SSR hoặc chưa đo được viewport (isMobile === null),
 * render Desktop để tránh flash mobile trên desktop.
 */
export default function AdminPage() {
  const isMobile = useIsMobile();

  // Tránh flash: SSR + lần render đầu → desktop.
  if (isMobile !== true) return <DesktopAdmin />;
  return <MobileAdmin />;
}