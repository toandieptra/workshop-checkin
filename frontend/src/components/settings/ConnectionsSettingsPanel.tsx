"use client";

import ZaloOaConnectionPanel from "./ZaloOaConnectionPanel";
import ZaloUserConnectionPanel from "./ZaloUserConnectionPanel";
import ZaloSmaxChannelsPanel, { type ZaloUserStatus } from "./ZaloSmaxChannelsPanel";
import SmaxTokensPanel from "./SmaxTokensPanel";
import { useCallback, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";

export default function ConnectionsSettingsPanel() {
  const { can } = useAuth();
  const [provider, setProvider] = useState<ZaloUserStatus["provider"] | null>(null);
  const onStatus = useCallback((st: ZaloUserStatus) => setProvider(st.provider), []);
  const [smaxKey, setSmaxKey] = useState(0);
  const onSmaxChange = useCallback(() => setSmaxKey((k) => k + 1), []);
  return <div className="space-y-5 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1"><div><h2 className="font-heading text-xl font-bold text-ink">Quản lý kết nối</h2><p className="mt-1 text-sm text-muted">Theo dõi và quản lý các kênh Zalo đang được hệ thống sử dụng.</p></div>{can(PERMISSIONS.zbsView) && <ZaloOaConnectionPanel />}<ZaloSmaxChannelsPanel key={smaxKey} onStatus={onStatus} />{(can(PERMISSIONS.connectionsView) || can(PERMISSIONS.connectionsManage)) && <SmaxTokensPanel onChange={onSmaxChange} />}{provider !== "smax" && <ZaloUserConnectionPanel />}</div>;
}
