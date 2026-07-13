"use client";
import { useAuth } from "@/contexts/AuthContext";
import type { Permission } from "@/lib/permissions";

export default function Can({ permission, children, fallback = null }: {
  permission: Permission; children: React.ReactNode; fallback?: React.ReactNode;
}) {
  return useAuth().can(permission) ? <>{children}</> : <>{fallback}</>;
}
