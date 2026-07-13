"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { hasPermission, type Permission } from "@/lib/permissions";

export interface AuthUser {
  id: string;
  name?: string;
  display_name?: string;
  email?: string;
  avatar_url?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
  [key: string]: unknown;
}

type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "forbidden";
interface AuthValue {
  user: AuthUser | null;
  permissions: string[];
  status: AuthStatus;
  error: string | null;
  can: (permission: Permission) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

function normalizeUser(payload: any): AuthUser {
  return (payload?.user || payload) as AuthUser;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
      if (res.status === 401) { setUser(null); setStatus("unauthenticated"); return; }
      if (res.status === 403) { setUser(null); setStatus("forbidden"); return; }
      if (!res.ok) throw new Error(await res.text());
      setUser(normalizeUser(await res.json()));
      setStatus("authenticated");
    } catch (e: any) {
      setUser(null);
      setStatus("unauthenticated");
      setError(e?.message || "Không thể kiểm tra phiên đăng nhập.");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST", credentials: "include",
      });
    } finally {
      setUser(null);
      setStatus("unauthenticated");
      router.replace("/admin/login");
      router.refresh();
    }
  }, [router]);

  const permissions = useMemo(() => Array.isArray(user?.permissions) ? user!.permissions! : [], [user]);
  const value = useMemo<AuthValue>(() => ({
    user, permissions, status, error,
    can: (permission) => hasPermission(permissions, permission),
    refresh, logout,
  }), [user, permissions, status, error, refresh, logout]);

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
