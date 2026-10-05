"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { hasPermission, type Permission } from "@/lib/permissions";
import { useAdminLoading } from "@/contexts/AdminLoadingContext";

export interface WorkshopAccess {
  workshop_id: string;
  role: string;
  permissions: string[];
}

export interface AuthUser {
  id: string;
  name?: string;
  display_name?: string;
  email?: string;
  avatar_url?: string;
  role?: string;
  roles?: string[];
  account_type?: "lark" | "local" | "checkin_guest";
  access_workshop_id?: string | null;
  access_starts_at?: string | null;
  access_expires_at?: string | null;
  permissions?: string[];
  workshop_access?: WorkshopAccess[];
  [key: string]: unknown;
}

type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "forbidden";
interface AuthValue {
  user: AuthUser | null;
  permissions: string[];
  status: AuthStatus;
  error: string | null;
  can: (permission: Permission) => boolean;
  canForWorkshop: (permission: Permission, workshopId?: string | null) => boolean;
  canInAnyWorkshop: (permission: Permission) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

function normalizeUser(payload: any): AuthUser {
  return (payload?.user || payload) as AuthUser;
}

function guestWindowOpen(user: AuthUser): boolean {
  const start = Date.parse(user.access_starts_at || "");
  const end = Date.parse(user.access_expires_at || "");
  return Boolean(user.access_workshop_id && Number.isFinite(start) && Number.isFinite(end) && start <= Date.now() && Date.now() < end);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { begin } = useAdminLoading();

  const refreshing = useRef(false);
  const lastBackgroundRefresh = useRef(0);
  const initialized = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const endPending = begin();
    if (!initialized.current) setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
      if (res.status === 401) { setUser(null); setStatus("unauthenticated"); return; }
      if (res.status === 403) { setUser(null); setStatus("forbidden"); return; }
      if (!res.ok) throw new Error(await res.text());
      const nextUser = normalizeUser(await res.json());
      setUser((current) => JSON.stringify(current) === JSON.stringify(nextUser) ? current : nextUser);
      setStatus("authenticated");
    } catch (e: any) {
      setUser(null);
      setStatus("unauthenticated");
      setError(e?.message || "Không thể kiểm tra phiên đăng nhập.");
    } finally {
      initialized.current = true;
      refreshing.current = false;
      endPending();
    }
  }, [begin]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "hidden" || Date.now() - lastBackgroundRefresh.current < 1500) return;
      lastBackgroundRefresh.current = Date.now();
      void refresh();
    };
    window.addEventListener("focus", update);
    window.addEventListener("auth:forbidden", update);
    document.addEventListener("visibilitychange", update);
    const timer = window.setInterval(update, 30000);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("auth:forbidden", update);
      document.removeEventListener("visibilitychange", update);
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (user?.account_type !== "checkin_guest") return;
    let timer: ReturnType<typeof setTimeout>;
    const checkExpiry = () => {
      const remaining = Date.parse(user.access_expires_at || "") - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) {
        setUser(null);
        setStatus("unauthenticated");
        setError("Tài khoản khách đã hết thời gian sử dụng.");
        return;
      }
      timer = setTimeout(checkExpiry, Math.min(remaining + 50, 2_147_483_647));
    };
    checkExpiry();
    return () => clearTimeout(timer);
  }, [user]);

  const logout = useCallback(async () => {
    const endPending = begin();
    try {
      await fetch("/api/auth/logout", {
        method: "POST", credentials: "include",
      });
    } finally {
      setUser(null);
      setStatus("unauthenticated");
      router.replace("/admin/login");
      router.refresh();
      endPending();
    }
  }, [begin, router]);

  const permissions = useMemo(() => user?.account_type !== "checkin_guest" && Array.isArray(user?.permissions) ? user!.permissions! : [], [user]);
  const can = useCallback((permission: Permission) => hasPermission(permissions, permission), [permissions]);
  const canForWorkshop = useCallback((permission: Permission, workshopId?: string | null) => {
    if (!workshopId) return false;
    if (user?.account_type === "checkin_guest") {
      return guestWindowOpen(user) && workshopId === user.access_workshop_id
        && ["guests.read", "checkin.read", "checkin.manage"].includes(permission)
        && Boolean(user.workshop_access?.some((item) => item.workshop_id === workshopId && hasPermission(item.permissions, permission)));
    }
    if (user?.role === "admin" || user?.role === "super_admin") return can(permission);
    const access = user?.workshop_access?.find((item) => item.workshop_id === workshopId);
    return Boolean(access && hasPermission(access.permissions, permission));
  }, [user, can]);
  const canInAnyWorkshop = useCallback((permission: Permission) => {
    if (user?.account_type === "checkin_guest") return canForWorkshop(permission, user.access_workshop_id);
    if (user?.role === "admin" || user?.role === "super_admin") return can(permission);
    return Boolean(user?.workshop_access?.some((item) => hasPermission(item.permissions, permission)));
  }, [user, can, canForWorkshop]);
  const value = useMemo<AuthValue>(() => ({
    user, permissions, status, error,
    can, canForWorkshop, canInAnyWorkshop,
    refresh, logout,
  }), [user, permissions, status, error, can, canForWorkshop, canInAnyWorkshop, refresh, logout]);

  useEffect(() => {
    if (pathname === "/admin/login" || status !== "unauthenticated") return;
    router.replace(`/admin/login?redirect=${encodeURIComponent(pathname || "/admin")}`);
  }, [pathname, router, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
