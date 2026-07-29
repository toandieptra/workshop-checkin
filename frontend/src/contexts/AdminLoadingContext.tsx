"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const PENDING_EVENT = "admin:pending";

export function beginAdminPending(): () => void {
  if (typeof window === "undefined" || !window.location.pathname.startsWith("/admin")) return () => {};
  window.dispatchEvent(new CustomEvent(PENDING_EVENT, { detail: 1 }));
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    window.dispatchEvent(new CustomEvent(PENDING_EVENT, { detail: -1 }));
  };
}

interface AdminLoadingValue {
  pending: boolean;
  begin: () => () => void;
}

const AdminLoadingContext = createContext<AdminLoadingValue | null>(null);

export function AdminLoadingProvider({ children }: { children: React.ReactNode }) {
  const [pendingCount, setPendingCount] = useState(0);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const navigationEndRef = useRef<(() => void) | null>(null);
  const navigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const begin = useCallback(() => beginAdminPending(), []);

  useEffect(() => {
    const onPending = (event: Event) => {
      const delta = (event as CustomEvent<number>).detail;
      setPendingCount((current) => Math.max(0, current + delta));
    };
    window.addEventListener(PENDING_EVENT, onPending);
    return () => window.removeEventListener(PENDING_EVENT, onPending);
  }, []);

  const finishNavigation = useCallback(() => {
    navigationEndRef.current?.();
    navigationEndRef.current = null;
    if (navigationTimerRef.current) clearTimeout(navigationTimerRef.current);
    navigationTimerRef.current = null;
  }, []);

  useEffect(() => finishNavigation(), [pathname, searchParams, finishNavigation]);
  useEffect(() => () => finishNavigation(), [finishNavigation]);

  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
    const target = new URL(anchor.href, window.location.href);
    if (target.origin !== window.location.origin || !target.pathname.startsWith("/admin")) return;
    if (target.pathname + target.search === window.location.pathname + window.location.search) return;
    if (navigationEndRef.current) {
      event.preventDefault();
      return;
    }
    navigationEndRef.current = begin();
    navigationTimerRef.current = setTimeout(finishNavigation, 15000);
  };

  const pending = pendingCount > 0;
  return (
    <AdminLoadingContext.Provider value={{ pending, begin }}>
      <div className={pending ? "admin-loading min-h-screen" : "min-h-screen"} aria-busy={pending} onClickCapture={onClickCapture}>
        {children}
      </div>
    </AdminLoadingContext.Provider>
  );
}

export function useAdminLoading(): AdminLoadingValue {
  const value = useContext(AdminLoadingContext);
  if (!value) throw new Error("useAdminLoading must be used inside AdminLoadingProvider");
  return value;
}
