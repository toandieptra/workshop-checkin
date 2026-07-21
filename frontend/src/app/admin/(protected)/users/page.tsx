"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";
import { ROLE_META, ROLE_ORDER } from "@/lib/roles";
import ColumnVisibilityMenu from "@/components/ColumnVisibilityMenu";
import { useOutsidePointerDown } from "@/hooks/useOutsidePointerDown";

interface ManagedUser {
  id: string;
  name?: string | null;
  email: string;
  role: string;
  is_active: boolean;
  enterprise_email?: string | null;
  lark_account_status?: "active" | "inactive" | "frozen" | "resigned" | "unknown" | null;
  lark_last_synced_at?: string | null;
  last_login_at?: string | null;
}

interface DirectorySyncStatus {
  status: "never" | "running" | "success" | "error";
  started_at?: string | null;
  finished_at?: string | null;
  users_seen: number;
  users_created: number;
  users_updated: number;
  users_deactivated: number;
  users_skipped: number;
  error?: string | null;
}

interface RoleOption {
  key: string;
  label: string;
}

interface PermissionCatalog {
  roles: RoleOption[];
}

type ColumnKey = "name" | "email" | "enterpriseEmail" | "lark" | "role" | "application" | "lastLogin";

const TABLE_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "name", label: "Người dùng" },
  { key: "email", label: "Email đăng nhập" },
  { key: "enterpriseEmail", label: "Email doanh nghiệp" },
  { key: "lark", label: "Lark" },
  { key: "role", label: "Vai trò" },
  { key: "application", label: "Ứng dụng" },
  { key: "lastLogin", label: "Đăng nhập gần nhất" },
];

const larkStatusLabel = (status?: ManagedUser["lark_account_status"]) => ({
  active: "Đang hoạt động", inactive: "Chưa kích hoạt", frozen: "Đã đóng băng",
  resigned: "Đã nghỉ việc", unknown: "Không rõ",
}[status || "unknown"]);

const LARK_STATUS_FILTER_OPTIONS: NonNullable<ManagedUser["lark_account_status"]>[] = [
  "active", "inactive", "frozen", "resigned", "unknown",
];

const APPLICATION_STATUS_FILTER_OPTIONS: { value: "active" | "inactive"; label: string }[] = [
  { value: "active", label: "Hoạt động" },
  { value: "inactive", label: "Đã khóa" },
];

export default function UsersPage() {
  const { can } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>(ROLE_ORDER.map((key) => ({ key, label: ROLE_META[key].label })));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [syncStatus, setSyncStatus] = useState<DirectorySyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [search, setSearch] = useState("");
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>({
    name: true,
    email: false,
    enterpriseEmail: false,
    lark: true,
    role: true,
    application: true,
    lastLogin: true,
  });
  const [larkStatusFilter, setLarkStatusFilter] = useState<NonNullable<ManagedUser["lark_account_status"]>[]>([]);
  const [applicationStatusFilter, setApplicationStatusFilter] = useState<("active" | "inactive")[]>([]);
  const [showLarkFilterMenu, setShowLarkFilterMenu] = useState(false);
  const [showApplicationFilterMenu, setShowApplicationFilterMenu] = useState(false);
  const larkFilterRef = useRef<HTMLDivElement>(null);
  const applicationFilterRef = useRef<HTMLDivElement>(null);
  useOutsidePointerDown(larkFilterRef, useCallback(() => setShowLarkFilterMenu(false), []), showLarkFilterMenu);
  useOutsidePointerDown(applicationFilterRef, useCallback(() => setShowApplicationFilterMenu(false), []), showApplicationFilterMenu);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi");
    return users.filter((user) => {
      if (query && ![
        user.name,
        user.email,
        user.enterprise_email,
        user.role,
        larkStatusLabel(user.lark_account_status),
        user.is_active ? "hoạt động" : "đã khóa",
      ].some((value) => value?.toLocaleLowerCase("vi").includes(query))) return false;
      if (larkStatusFilter.length && !larkStatusFilter.includes(user.lark_account_status || "unknown")) return false;
      if (applicationStatusFilter.length && !applicationStatusFilter.includes(user.is_active ? "active" : "inactive")) return false;
      return true;
    });
  }, [search, users, larkStatusFilter, applicationStatusFilter]);

  const toggleLarkStatusFilter = (value: NonNullable<ManagedUser["lark_account_status"]>) => {
    setLarkStatusFilter((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );
  };

  const toggleApplicationStatusFilter = (value: "active" | "inactive") => {
    setApplicationStatusFilter((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );
  };

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const [loadedUsers, status, permissionCatalog] = await Promise.all([
        adminApi<ManagedUser[]>("/users"),
        adminApi<DirectorySyncStatus>("/users/directory-sync/status"),
        adminApi<PermissionCatalog>("/users/catalog"),
      ]);
      setUsers(loadedUsers);
      setSyncStatus(status);
      setRoles(permissionCatalog.roles);
    } catch (e: any) {
      setMessage("Không tải được người dùng: " + (e?.message || "không rõ"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (can(PERMISSIONS.usersView)) void load(); }, [can, load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setSaving("new");
    setMessage("");
    try {
      await adminApi("/users", { method: "POST", body: JSON.stringify({ email, role, is_active: true }) });
      setEmail("");
      await load();
    } catch (e: any) {
      setMessage("Không tạo được tài khoản: " + (e?.message || "không rõ"));
    } finally { setSaving(null); }
  };

  const update = async (user: ManagedUser, changes: Partial<ManagedUser>) => {
    setSaving(user.id);
    setMessage("");
    try {
      const updated = await adminApi<ManagedUser>(`/users/${user.id}`, {
        method: "PATCH", body: JSON.stringify(changes),
      });
      setUsers((current) => current.map((item) => item.id === user.id ? updated : item));
    } catch (e: any) {
      setMessage("Không cập nhật được tài khoản: " + (e?.message || "không rõ"));
    } finally { setSaving(null); }
  };

  const syncDirectory = async () => {
    setSyncing(true);
    setMessage("");
    try {
      const status = await adminApi<DirectorySyncStatus>("/users/directory-sync", { method: "POST" });
      setSyncStatus(status);
      setMessage(`Đồng bộ Lark hoàn tất: ${status.users_seen} tài khoản, tạo ${status.users_created}, khóa ${status.users_deactivated}.`);
      await load();
    } catch (e: any) {
      setMessage("Không đồng bộ được danh bạ Lark: " + (e?.message || "không rõ"));
    } finally { setSyncing(false); }
  };

  if (!can(PERMISSIONS.usersView)) return <div className="p-8 text-center text-muted">403 — Bạn không có quyền quản lý người dùng.</div>;

  return <div className="p-4 sm:p-6"><div className="max-w-5xl mx-auto">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
      <div><h1 className="text-2xl font-bold text-brand-teal">Người dùng &amp; phân quyền</h1><p className="text-sm text-muted">Chỉ tài khoản được tạo trước và đang active mới có thể đăng nhập bằng Lark.</p></div>
      <div className="flex gap-2">
        <button disabled={syncing} onClick={() => void syncDirectory()} className="bg-brand text-brand-teal px-3 py-2 rounded-sm text-sm font-semibold disabled:opacity-60">{syncing ? "Đang đồng bộ…" : "Đồng bộ danh bạ Lark"}</button>
        <button onClick={() => void load()} className="border border-line px-3 py-2 rounded-sm text-sm">Làm mới</button>
      </div>
    </div>
    {syncStatus && <div className="mb-4 border border-line bg-surface-muted rounded-sm p-3 text-sm text-muted">
      <span className="font-medium text-foreground">Danh bạ Lark: </span>
      {syncStatus.status === "never" ? "chưa đồng bộ" : syncStatus.status === "running" ? "đang đồng bộ" : syncStatus.status === "error" ? "đồng bộ lỗi" : "đã đồng bộ"}
      {syncStatus.finished_at && <> lúc {new Date(syncStatus.finished_at).toLocaleString("vi-VN")}</>}
      {syncStatus.status === "success" && <> · {syncStatus.users_seen} người · tạo {syncStatus.users_created} · cập nhật {syncStatus.users_updated} · khóa {syncStatus.users_deactivated}</>}
      {syncStatus.error && <div className="mt-1 text-red-700">{syncStatus.error}</div>}
    </div>}
    <form onSubmit={create} className="mb-4 bg-surface border border-line rounded-md p-4 flex flex-col sm:flex-row gap-2">
      <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@congty.com" className="flex-1 border border-line rounded-sm px-3 py-2 text-sm" />
      <select value={role} onChange={(e) => setRole(e.target.value)} className="border border-line rounded-sm px-3 py-2 text-sm" aria-label="Vai trò cho người dùng mới">
        {roles.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select>
      <button disabled={saving === "new"} className="bg-brand text-brand-teal px-4 py-2 rounded-sm text-sm font-semibold disabled:opacity-60">{saving === "new" ? "Đang tạo…" : "Cấp tài khoản"}</button>
    </form>
    {message && <div className="mb-3 p-3 bg-red-50 text-red-700 rounded-sm text-sm">{message}</div>}
    <div className="mb-3 flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="relative flex-1">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted">
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Tìm theo tên, email, vai trò, trạng thái…"
          aria-label="Tìm kiếm người dùng"
          className="w-full border border-line bg-surface rounded-sm pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
        />
      </div>
      <ColumnVisibilityMenu columns={TABLE_COLUMNS} visible={visibleColumns} onChange={setVisibleColumns} />
      <div ref={larkFilterRef} className="relative">
        <button
          type="button"
          onClick={() => { setShowLarkFilterMenu((current) => !current); setShowApplicationFilterMenu(false); }}
          aria-expanded={showLarkFilterMenu}
          className="w-full sm:w-auto border border-line bg-surface px-3 py-2 rounded-sm text-sm inline-flex items-center justify-center gap-2 hover:bg-surface-muted"
        >
          <span>Trạng thái Lark</span>
          {larkStatusFilter.length > 0 && <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-brand text-brand-teal text-xs font-semibold">{larkStatusFilter.length}</span>}
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        {showLarkFilterMenu && <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-line bg-surface p-2 shadow-lg">
          <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">Trạng thái Lark</div>
          {LARK_STATUS_FILTER_OPTIONS.map((status) => <label key={status} className="flex items-center gap-2 px-2 py-2 rounded-sm text-sm cursor-pointer hover:bg-surface-muted">
            <input type="checkbox" checked={larkStatusFilter.includes(status)} onChange={() => toggleLarkStatusFilter(status)} className="accent-brand" />
            {larkStatusLabel(status)}
          </label>)}
          {larkStatusFilter.length > 0 && <button type="button" onClick={() => setLarkStatusFilter([])} className="mt-1 w-full border-t border-line px-2 pt-2 text-left text-xs font-medium text-brand hover:underline">Xóa bộ lọc</button>}
        </div>}
      </div>
      <div ref={applicationFilterRef} className="relative">
        <button
          type="button"
          onClick={() => { setShowApplicationFilterMenu((current) => !current); setShowLarkFilterMenu(false); }}
          aria-expanded={showApplicationFilterMenu}
          className="w-full sm:w-auto border border-line bg-surface px-3 py-2 rounded-sm text-sm inline-flex items-center justify-center gap-2 hover:bg-surface-muted"
        >
          <span>Trạng thái ứng dụng</span>
          {applicationStatusFilter.length > 0 && <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-brand text-brand-teal text-xs font-semibold">{applicationStatusFilter.length}</span>}
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        {showApplicationFilterMenu && <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-line bg-surface p-2 shadow-lg">
          <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">Trạng thái ứng dụng</div>
          {APPLICATION_STATUS_FILTER_OPTIONS.map((option) => <label key={option.value} className="flex items-center gap-2 px-2 py-2 rounded-sm text-sm cursor-pointer hover:bg-surface-muted">
            <input type="checkbox" checked={applicationStatusFilter.includes(option.value)} onChange={() => toggleApplicationStatusFilter(option.value)} className="accent-brand" />
            {option.label}
          </label>)}
          {applicationStatusFilter.length > 0 && <button type="button" onClick={() => setApplicationStatusFilter([])} className="mt-1 w-full border-t border-line px-2 pt-2 text-left text-xs font-medium text-brand hover:underline">Xóa bộ lọc</button>}
        </div>}
      </div>
    </div>
    <div className="admin-table-scroll bg-surface border border-line rounded-md">
      {loading ? <div className="p-6 text-muted text-sm">Đang tải…</div> : <table className="w-full min-w-max text-sm">
        <thead className="text-muted"><tr>
          {visibleColumns.name && <th className="text-left p-3 sticky top-0 z-10 bg-surface-muted">Người dùng</th>}
          {visibleColumns.email && <th className="text-left p-3 sticky top-0 z-10 bg-surface-muted">Email đăng nhập</th>}
          {visibleColumns.enterpriseEmail && <th className="text-left p-3 sticky top-0 z-10 bg-surface-muted">Email doanh nghiệp</th>}
          {visibleColumns.lark && <th className="text-left p-3 sticky top-0 z-10 bg-surface-muted">Lark</th>}
          {visibleColumns.role && <th className="text-left p-3 sticky top-0 z-10 bg-surface-muted">Vai trò</th>}
          {visibleColumns.application && <th className="text-center p-3 sticky top-0 z-10 bg-surface-muted">Ứng dụng</th>}
          {visibleColumns.lastLogin && <th className="text-left p-3 sticky top-0 z-10 bg-surface-muted">Đăng nhập gần nhất</th>}
        </tr></thead>
        <tbody className="divide-y divide-line">{filteredUsers.map((user) => <tr key={user.id}>
          {visibleColumns.name && <td className="p-3 font-medium">{user.name || "Chưa có tên"}</td>}
          {visibleColumns.email && <td className="p-3">{user.email}</td>}
          {visibleColumns.enterpriseEmail && <td className="p-3">{user.enterprise_email || "—"}</td>}
          {visibleColumns.lark && <td className="p-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs ${user.lark_account_status === "active" ? "bg-green-100 text-green-700" : user.lark_account_status && user.lark_account_status !== "unknown" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>{larkStatusLabel(user.lark_account_status)}</span></td>}
          {visibleColumns.role && <td className="p-3"><select disabled={saving === user.id} value={user.role} onChange={(e) => void update(user, { role: e.target.value })} className="border border-line rounded-sm px-2 py-1" aria-label={`Vai trò của ${user.name || user.email}`}>
            {roles.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select></td>}
          {visibleColumns.application && <td className="p-3 text-center">{user.role === "super_admin" ? (
            <span className="inline-flex px-2 py-1 rounded-full text-xs bg-green-100 text-green-700" title="Tài khoản super_admin luôn hoạt động">Luôn hoạt động</span>
          ) : (
            <button disabled={saving === user.id} onClick={() => void update(user, { is_active: !user.is_active })} className={`px-2 py-1 rounded-full text-xs ${user.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{user.is_active ? "Hoạt động" : "Đã khóa"}</button>
          )}</td>}
          {visibleColumns.lastLogin && <td className="p-3 text-muted">{user.last_login_at ? new Date(user.last_login_at).toLocaleString("vi-VN") : "—"}</td>}
        </tr>)}</tbody>
      </table>}
      {!loading && !filteredUsers.length && !message && <div className="p-6 text-center text-muted text-sm">{search ? "Không tìm thấy người dùng phù hợp." : "Chưa có người dùng."}</div>}
    </div>
  </div></div>;
}
