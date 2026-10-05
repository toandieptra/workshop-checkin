"use client";
import { useAuth } from "@/contexts/AuthContext";
import type { Permission } from "@/lib/permissions";

export default function Can({ permission, workshopId, anyWorkshop = false, children, fallback = null }: {
  permission: Permission;
  workshopId?: string | null;
  anyWorkshop?: boolean;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { can, canForWorkshop, canInAnyWorkshop } = useAuth();
  const allowed = workshopId !== undefined ? canForWorkshop(permission, workshopId)
    : anyWorkshop ? canInAnyWorkshop(permission) : can(permission);
  return allowed ? <>{children}</> : <>{fallback}</>;
}
