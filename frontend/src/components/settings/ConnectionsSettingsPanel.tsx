"use client";

import ZaloOaConnectionPanel from "./ZaloOaConnectionPanel";
import ZaloUserConnectionPanel from "./ZaloUserConnectionPanel";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";

export default function ConnectionsSettingsPanel() {
  const { can } = useAuth();
  return <div className="space-y-5"><div><h2 className="font-heading text-xl font-bold text-ink">Quản lý kết nối</h2><p className="mt-1 text-sm text-muted">Theo dõi và quản lý các kênh Zalo đang được hệ thống sử dụng.</p></div>{can(PERMISSIONS.zbsView) && <ZaloOaConnectionPanel />}<ZaloUserConnectionPanel /></div>;
}
