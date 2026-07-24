"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";
import UsersSettingsPanel from "@/components/settings/UsersSettingsPanel";
import RolePermissionsSettingsPanel from "@/components/settings/RolePermissionsSettingsPanel";
import ConnectionsSettingsPanel from "@/components/settings/ConnectionsSettingsPanel";
import ZbsTemplateSettingsPanel from "@/components/settings/ZbsTemplateSettingsPanel";

const TABS = [
  { key: "nguoi-dung", label: "Người dùng", description: "Tài khoản quản trị", permission: PERMISSIONS.usersView },
  { key: "phan-quyen", label: "Phân quyền", description: "Vai trò và quyền hạn", permission: PERMISSIONS.usersManage },
  { key: "ket-noi", label: "Kết nối", description: "Zalo OA và Zalo user", permission: PERMISSIONS.connectionsView },
  { key: "mau-tin-zbs", label: "Mẫu tin ZBS", description: "Mẫu tin và gửi tự động", permission: PERMISSIONS.zbsView },
] as const;

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const { can } = useAuth();
  const visibleTabs = TABS.filter((tab) => can(tab.permission));
  const requestedTab = searchParams.get("tab");
  const activeTab = visibleTabs.find((tab) => tab.key === requestedTab) || visibleTabs[0];

  if (!activeTab) return <div className="p-8 text-center text-muted">403 — Bạn không có quyền xem cài đặt.</div>;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-accent">Quản trị hệ thống</p>
        <h1 className="font-heading mt-1 text-2xl font-bold text-ink">Cài đặt</h1>
        <p className="mt-1 text-sm text-muted">Quản lý tài khoản, quyền truy cập và các kết nối của hệ thống.</p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
          <nav aria-label="Danh mục cài đặt" className="flex gap-2 overflow-x-auto p-2 lg:flex-col">
            {visibleTabs.map((tab) => {
              const active = tab.key === activeTab.key;
              return (
                <Link
                  key={tab.key}
                  href={`/admin/cai-dat?tab=${tab.key}`}
                  aria-current={active ? "page" : undefined}
                  className={`min-w-[150px] rounded-md border-l-4 px-4 py-3 transition lg:min-w-0 ${active ? "border-brand bg-brand/10 text-brand-teal" : "border-transparent text-text-secondary hover:bg-surface-muted"}`}
                >
                  <span className="block text-sm font-bold">{tab.label}</span>
                  <span className="mt-0.5 block text-xs text-muted">{tab.description}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <section className="min-w-0">
          {activeTab.key === "nguoi-dung" && <UsersSettingsPanel />}
          {activeTab.key === "phan-quyen" && <RolePermissionsSettingsPanel />}
          {activeTab.key === "ket-noi" && <ConnectionsSettingsPanel />}
          {activeTab.key === "mau-tin-zbs" && <ZbsTemplateSettingsPanel />}
        </section>
      </div>
    </main>
  );
}
