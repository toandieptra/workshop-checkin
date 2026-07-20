"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/api";
import { PERMISSIONS } from "@/lib/permissions";
import { useAuth } from "@/contexts/AuthContext";

interface RoleDefinition {
  key: string;
  label: string;
  description: string;
  permissions: string[];
  built_in: boolean;
}

interface PermissionCatalog {
  permissions: string[];
  roles: RoleDefinition[];
}

const GROUPS = [
  { key: "workshops", label: "Workshop", description: "Quản lý danh sách và thông tin workshop" },
  { key: "guests", label: "Khách mời", description: "Quản lý dữ liệu khách tham dự" },
  { key: "checkin", label: "Check-in & thống kê", description: "Theo dõi và thực hiện check-in" },
  { key: "registration_forms", label: "Form đăng ký", description: "Quản lý biểu mẫu đăng ký workshop" },
  { key: "lark", label: "Đồng bộ Lark", description: "Xem và đồng bộ dữ liệu Lark" },
  { key: "uploads", label: "Tệp tải lên", description: "Tải tệp và tài nguyên lên hệ thống" },
  { key: "zbs", label: "Mẫu tin ZBS", description: "Xem mẫu tin, đồng bộ và cấu hình gửi tự động" },
  { key: "users", label: "Người dùng & phân quyền", description: "Quản lý người dùng và vai trò" },
];

const ACTION_LABELS: Record<string, string> = {
  read: "Xem", write: "Tạo và chỉnh sửa", delete: "Xóa", export: "Xuất dữ liệu",
  manage: "Quản lý", sync: "Đồng bộ", create: "Tải lên",
};

function RoleIcon({ selected }: { selected: boolean }) {
  return (
    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${selected ? "bg-brand text-white" : "bg-surface-muted text-brand-accent"}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <circle cx="12" cy="8" r="3.5" /><path d="M5.5 19c.6-3.5 2.8-5.5 6.5-5.5s5.9 2 6.5 5.5" />
      </svg>
    </span>
  );
}

export default function RolePermissionsPage() {
  const { can, refresh } = useAuth();
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [selectedRole, setSelectedRole] = useState("admin");
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDescription, setNewRoleDescription] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const data = await adminApi<PermissionCatalog>("/users/catalog");
      setCatalog(data);
      const initialRole = data.roles.find((role) => role.key === "admin") || data.roles[0];
      if (initialRole) {
        setSelectedRole(initialRole.key);
        setDraft(new Set(initialRole.permissions));
      }
    } catch (error: any) {
      setMessage("Không tải được danh sách quyền: " + (error?.message || "không rõ"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (can(PERMISSIONS.usersManage)) void load(); }, [can, load]);

  const selectRole = (role: RoleDefinition) => {
    setSelectedRole(role.key);
    setDraft(new Set(role.permissions));
    setMessage("");
  };

  const groupedPermissions = useMemo(() => GROUPS.map((group) => ({
    ...group,
    permissions: (catalog?.permissions || []).filter((permission) => permission.startsWith(group.key + ".")),
  })).filter((group) => group.permissions.length), [catalog]);

  const currentRole = catalog?.roles.find((role) => role.key === selectedRole);
  const original = new Set(currentRole?.permissions || []);
  const dirty = draft.size !== original.size || [...draft].some((permission) => !original.has(permission));
  const disabled = selectedRole === "user";

  const toggle = (permission: string) => {
    if (disabled || (selectedRole === "super_admin" && permission === "users.manage")) return;
    setDraft((current) => {
      const next = new Set(current);
      next.has(permission) ? next.delete(permission) : next.add(permission);
      return next;
    });
  };

  const save = async () => {
    if (!dirty || disabled) return;
    setSaving(true);
    setMessage("");
    try {
      const result = await adminApi<{ role: string; permissions: string[] }>(`/users/roles/${selectedRole}`, {
        method: "PUT",
        body: JSON.stringify({ permissions: [...draft].sort() }),
      });
      setCatalog((current) => current ? {
        ...current,
        roles: current.roles.map((role) => role.key === selectedRole ? { ...role, permissions: result.permissions } : role),
      } : current);
      setMessage("Đã lưu quyền cho vai trò thành công.");
      await refresh();
    } catch (error: any) {
      setMessage("Không thể lưu thay đổi: " + (error?.message || "không rõ"));
    } finally {
      setSaving(false);
    }
  };

  const createRole = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newRoleName.trim()) return;
    setCreating(true);
    setMessage("");
    try {
      const role = await adminApi<RoleDefinition>("/users/roles", {
        method: "POST",
        body: JSON.stringify({ name: newRoleName, description: newRoleDescription }),
      });
      setCatalog((current) => current ? { ...current, roles: [...current.roles, role] } : current);
      setSelectedRole(role.key);
      setDraft(new Set());
      setNewRoleName("");
      setNewRoleDescription("");
      setShowCreateForm(false);
      setMessage(`Đã tạo vai trò ${role.label}. Hãy chọn các quyền rồi lưu thay đổi.`);
    } catch (error: any) {
      setMessage("Không thể tạo vai trò: " + (error?.message || "không rõ"));
    } finally {
      setCreating(false);
    }
  };

  if (!can(PERMISSIONS.usersManage)) return <div className="max-w-6xl mx-auto p-6 text-error">Bạn không có quyền quản lý vai trò.</div>;

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-accent">Quản trị người dùng</p>
        <h1 className="font-heading mt-1 text-2xl font-bold text-ink">Vai trò & quyền hạn</h1>
        <p className="mt-1 text-sm text-muted">Chọn một vai trò và thiết lập quyền truy cập chi tiết cho các chức năng workshop.</p>
      </div>

      <div className="grid min-h-[650px] overflow-hidden rounded-lg border border-line bg-white shadow-sm lg:grid-cols-[300px_1fr]">
        <aside className="border-b border-line bg-[#f8fbfb] lg:border-b-0 lg:border-r">
          <div className="border-b border-line px-5 py-4">
            <div className="flex items-center justify-between">
              <h2 className="font-heading font-bold text-ink">Danh sách vai trò</h2>
              <button type="button" onClick={() => setShowCreateForm((current) => !current)} className="grid h-8 w-8 place-items-center rounded-full border border-line bg-white text-lg font-semibold text-brand-accent transition hover:bg-brand hover:text-white" aria-label="Tạo vai trò mới" title="Tạo vai trò mới">+</button>
            </div>
            <p className="mt-1 text-xs text-muted">Tổng số: {catalog?.roles.length || 0} vai trò</p>
          </div>
          {showCreateForm && <form onSubmit={(event) => void createRole(event)} className="space-y-3 border-b border-line bg-white px-4 py-4">
            <label className="block text-xs font-semibold text-text-secondary">Tên vai trò
              <input autoFocus required maxLength={80} value={newRoleName} onChange={(event) => setNewRoleName(event.target.value)} placeholder="Ví dụ: Điều phối viên" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
            </label>
            <label className="block text-xs font-semibold text-text-secondary">Mô tả <span className="font-normal text-muted">(không bắt buộc)</span>
              <input maxLength={200} value={newRoleDescription} onChange={(event) => setNewRoleDescription(event.target.value)} placeholder="Phạm vi công việc của vai trò" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreateForm(false)} className="rounded-md px-3 py-2 text-xs font-semibold text-muted hover:bg-surface-muted">Hủy</button>
              <button type="submit" disabled={creating || !newRoleName.trim()} className="rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{creating ? "Đang tạo..." : "Tạo vai trò"}</button>
            </div>
          </form>}
          <div className="p-2">
            {(catalog?.roles || []).map((role) => {
              const selected = selectedRole === role.key;
              return (
                <button
                  key={role.key}
                  type="button"
                  onClick={() => selectRole(role)}
                  className={`relative flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition ${selected ? "bg-white shadow-sm ring-1 ring-line" : "hover:bg-white/80"}`}
                >
                  {selected && <span className="absolute inset-y-2 left-0 w-1 rounded-r bg-brand" />}
                  <RoleIcon selected={selected} />
                  <span className="min-w-0">
                    <span className={`block truncate text-sm font-semibold ${selected ? "text-ink" : "text-text-secondary"}`}>{role.label}</span>
                    <span className="mt-0.5 block line-clamp-2 text-[11px] leading-4 text-muted">{role.description || "Vai trò tùy chỉnh"}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="min-w-0">
          <div className="flex flex-col gap-4 border-b border-line px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-heading text-xl font-bold text-ink">{currentRole?.label || selectedRole}</h2>
                {disabled && <span className="rounded-full bg-surface-muted px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Mặc định</span>}
              </div>
              <p className="mt-1 text-sm text-muted">{currentRole?.description || "Thiết lập quyền truy cập cho vai trò này."}</p>
            </div>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || disabled || saving}
              className="min-h-10 rounded-md bg-brand px-5 text-sm font-semibold text-white transition hover:bg-brand-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Đang lưu..." : "Lưu thay đổi"}
            </button>
          </div>

          {message && <div className={`mx-5 mt-4 rounded-md border px-4 py-3 text-sm ${message.startsWith("Đã lưu") ? "border-success-border bg-success-soft text-success" : "border-red-200 bg-red-50 text-error"}`}>{message}</div>}

          <div className="px-5 py-5">
            {disabled && <div className="mb-5 rounded-md border border-line bg-surface-muted px-4 py-3 text-sm text-text-secondary">Vai trò Người dùng được giữ cố định và không thể chỉnh sửa quyền.</div>}
            {loading ? (
              <div className="py-16 text-center text-sm text-muted">Đang tải danh sách quyền...</div>
            ) : (
              <div className="space-y-4">
                {groupedPermissions.map((group) => (
                  <div key={group.key} className="overflow-hidden rounded-md border border-line">
                    <div className="border-b border-line bg-[#f7fafb] px-4 py-3">
                      <h3 className="text-sm font-bold text-ink">{group.label}</h3>
                      <p className="mt-0.5 text-xs text-muted">{group.description}</p>
                    </div>
                    <div className="grid sm:grid-cols-2 xl:grid-cols-3">
                      {group.permissions.map((permission) => {
                        const action = permission.split(".").pop() || permission;
                        const checked = draft.has(permission);
                        const locked = disabled || (selectedRole === "super_admin" && permission === "users.manage");
                        return (
                          <label key={permission} className={`flex min-h-[66px] items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:border-r ${locked ? "cursor-not-allowed bg-gray-50/70" : "cursor-pointer hover:bg-surface-muted/50"}`}>
                            <input type="checkbox" checked={checked} disabled={locked} onChange={() => toggle(permission)} className="peer sr-only" />
                            <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-brand" : "bg-[#cbd9db]"} ${locked ? "opacity-55" : ""}`}>
                              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-text-primary">{ACTION_LABELS[action] || action}</span>
                              <span className="block truncate font-mono text-[10px] text-muted">{permission}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
