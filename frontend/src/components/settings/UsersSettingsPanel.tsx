"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";
import { ROLE_META, ROLE_ORDER } from "@/lib/roles";
import AccountManagementModal, { type AccountModalState, type AccountWorkshop, type ManagedAccount } from "@/components/settings/AccountManagementModal";
import ColumnVisibilityMenu from "@/components/ColumnVisibilityMenu";
import { useOutsidePointerDown } from "@/hooks/useOutsidePointerDown";
import { useDialogFocus } from "@/hooks/useDialogFocus";

type ManagedUser = ManagedAccount;

interface AdminSession {
  id: string;
  user_id: string;
  user_agent?: string | null;
  ip_address?: string | null;
  created_at?: string | null;
  last_seen_at?: string | null;
  expires_at?: string | null;
  is_current: boolean;
  is_active: boolean;
  status: "active" | "expired";
}

interface LoginSessionsModalProps {
  user: ManagedUser;
  sessions: AdminSession[];
  loading: boolean;
  error: string;
  actionId: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onRevoke: (session: AdminSession) => void;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}

function deviceLabel(userAgent?: string | null): string {
  if (!userAgent) return "Thiết bị không xác định";
  const browser = userAgent.includes("Electron/") ? "Ứng dụng máy tính"
    : userAgent.includes("Edg/") ? "Microsoft Edge"
    : userAgent.includes("OPR/") ? "Opera"
      : userAgent.includes("Chrome/") ? "Google Chrome"
        : userAgent.includes("Firefox/") ? "Firefox"
          : userAgent.includes("Safari/") && !userAgent.includes("Chrome/") ? "Safari"
            : "Trình duyệt khác";
  const os = userAgent.includes("iPhone") || userAgent.includes("iPad") ? "iOS"
    : userAgent.includes("Windows") ? "Windows"
      : userAgent.includes("Mac OS X") ? "macOS"
      : userAgent.includes("Android") ? "Android"
        : userAgent.includes("Linux") ? "Linux"
          : "Hệ điều hành khác";
  return `${browser} · ${os}`;
}

function LoginSessionsModal({ user, sessions, loading, error, actionId, onClose, onRefresh, onRevoke }: LoginSessionsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, dialogRef);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !actionId) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [actionId, onClose]);

  const activeCount = sessions.filter((session) => session.is_active).length;

  return <div
    className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
    onClick={() => !actionId && onClose()}
    role="dialog"
    aria-modal="true"
    aria-labelledby="login-sessions-title"
  >
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-xl sm:max-h-[90vh] sm:rounded-md sm:pb-0"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 id="login-sessions-title" className="font-semibold text-brand-teal">Lịch sử phiên đăng nhập</h2>
          <p className="mt-1 truncate text-xs text-muted">{user.name || user.username || user.email} · {activeCount}/{sessions.length} phiên còn hiệu lực</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onRefresh} disabled={loading || Boolean(actionId)} className="min-h-11 rounded-sm border border-line px-3 text-sm text-brand-teal hover:bg-brand/5 disabled:opacity-50">Làm mới</button>
          <button type="button" onClick={onClose} disabled={Boolean(actionId)} aria-label="Đóng" className="min-h-11 min-w-11 text-xl leading-none text-muted disabled:opacity-50">×</button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {error && <div role="alert" className="mb-3 rounded-sm border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {loading ? <div className="p-8 text-center text-sm text-muted">Đang tải lịch sử phiên đăng nhập…</div> : sessions.length === 0 ? (
          !error && <div className="rounded-md border border-dashed border-line p-8 text-center text-sm text-muted">Chưa có phiên đăng nhập nào được lưu.</div>
        ) : <div className="space-y-3">
          {sessions.map((session) => <article key={session.id} className="rounded-md border border-line bg-white p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-ink">{deviceLabel(session.user_agent)}</h3>
                  {session.is_current && <span className="rounded-full bg-brand/15 px-2 py-1 text-xs font-medium text-brand-teal">Thiết bị này</span>}
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${session.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                    {session.is_active ? "Còn hiệu lực" : "Đã hết hạn"}
                  </span>
                </div>
                <p className="mt-1 break-all text-xs text-muted" title={session.user_agent || undefined}>{session.user_agent || "Không có thông tin trình duyệt"}</p>
              </div>
              {session.is_active && <button
                type="button"
                onClick={() => onRevoke(session)}
                disabled={Boolean(actionId)}
                aria-label={`Đăng xuất ${deviceLabel(session.user_agent)}`}
                className="min-h-11 shrink-0 rounded-sm border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {actionId === session.id ? "Đang đăng xuất…" : "Đăng xuất thiết bị"}
              </button>}
            </div>
            <dl className="mt-3 grid gap-x-4 gap-y-2 border-t border-line pt-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-muted">Địa chỉ IP</dt><dd className="mt-0.5 font-medium text-ink">{session.ip_address || "—"}</dd></div>
              <div><dt className="text-muted">Đăng nhập lúc</dt><dd className="mt-0.5 font-medium text-ink">{formatDateTime(session.created_at)}</dd></div>
              <div><dt className="text-muted">Hoạt động gần nhất</dt><dd className="mt-0.5 font-medium text-ink">{formatDateTime(session.last_seen_at)}</dd></div>
              <div><dt className="text-muted">Hết hạn lúc</dt><dd className="mt-0.5 font-medium text-ink">{formatDateTime(session.expires_at)}</dd></div>
            </dl>
          </article>)}
        </div>}
      </div>

      <div className="flex justify-end border-t border-line bg-surface px-4 py-3 sm:px-5">
        <button type="button" onClick={onClose} disabled={Boolean(actionId)} className="min-h-11 rounded-sm border border-line px-4 py-2 text-sm hover:bg-surface-muted disabled:opacity-50">Đóng</button>
      </div>
    </div>
  </div>;
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

type ColumnKey = "access" | "accountActions" | "name" | "email" | "enterpriseEmail" | "lark" | "role" | "application" | "lastLogin";

const TABLE_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "name", label: "Người dùng" },
  { key: "email", label: "Email đăng nhập" },
  { key: "enterpriseEmail", label: "Email doanh nghiệp" },
  { key: "lark", label: "Lark" },
  { key: "role", label: "Vai trò" },
  { key: "application", label: "Ứng dụng" },
  { key: "lastLogin", label: "Đăng nhập gần nhất" },
  { key: "access", label: "Quyền khách check-in" },
  { key: "accountActions", label: "Quản lý tài khoản" },
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

export default function UsersSettingsPanel() {
  const { user: authUser, can, logout } = useAuth();
  const [accountModal, setAccountModal] = useState<AccountModalState | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [workshops, setWorkshops] = useState<AccountWorkshop[]>([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const guestStatus = useCallback((user: ManagedUser) => !user.is_active ? "Đã khóa"
    : !user.access_workshop_id ? "Workshop đã bị xóa"
    : Date.parse(user.access_expires_at || "") <= now ? "Đã hết hạn"
    : Date.parse(user.access_starts_at || "") > now ? "Chưa đến giờ" : "Đang có hiệu lực", [now]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>(ROLE_ORDER.map((key) => ({ key, label: ROLE_META[key].label })));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [syncStatus, setSyncStatus] = useState<DirectorySyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [sessionUser, setSessionUser] = useState<ManagedUser | null>(null);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>({
    name: true,
    email: true,
    access: true,
    accountActions: true,
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
      if (typeFilter && (user.account_type || "lark") !== typeFilter) return false;
      if (query && ![
        user.name,
        user.email,
        user.username,
        user.enterprise_email,
        user.role,
        user.account_type === "checkin_guest" ? `khách check-in ${guestStatus(user)}` : user.account_type === "local" ? "tài khoản trực tiếp" : "Lark",
        larkStatusLabel(user.lark_account_status),
        user.is_active ? "hoạt động" : "đã khóa",
      ].some((value) => value?.toLocaleLowerCase("vi").includes(query))) return false;
      if (larkStatusFilter.length && !larkStatusFilter.includes(user.lark_account_status || "unknown")) return false;
      if (applicationStatusFilter.length && !applicationStatusFilter.includes(user.is_active ? "active" : "inactive")) return false;
      return true;
    });
  }, [search, users, larkStatusFilter, applicationStatusFilter, typeFilter, guestStatus]);

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
      const [loadedUsers, status, permissionCatalog, managedWorkshops] = await Promise.all([
        adminApi<ManagedUser[]>("/users"),
        adminApi<DirectorySyncStatus>("/users/directory-sync/status"),
        adminApi<PermissionCatalog>("/users/catalog"),
        adminApi<AccountWorkshop[]>("/workshops"),
      ]);
      setUsers(loadedUsers);
      setWorkshops(managedWorkshops);
      setSyncStatus(status);
      setRoles(permissionCatalog.roles);
    } catch (e: any) {
      setMessage("Không tải được người dùng: " + (e?.message || "không rõ"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (can(PERMISSIONS.usersView)) void load(); }, [can, load]);

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

  const loadSessions = useCallback(async (userId: string) => {
    setSessionsLoading(true);
    setSessionsError("");
    try {
      const loaded = await adminApi<AdminSession[]>(`/users/${userId}/sessions`);
      setSessions(Array.isArray(loaded) ? loaded : []);
    } catch (e: any) {
      setSessionsError("Không tải được lịch sử phiên đăng nhập: " + (e?.message || "không rõ"));
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const openSessions = useCallback((user: ManagedUser) => {
    setSessionUser(user);
    setSessions([]);
    setSessionsError("");
    void loadSessions(user.id);
  }, [loadSessions]);

  const closeSessions = useCallback(() => {
    if (sessionActionId) return;
    setSessionUser(null);
    setSessions([]);
    setSessionsError("");
  }, [sessionActionId]);

  const refreshSessions = useCallback(() => {
    if (sessionUser) void loadSessions(sessionUser.id);
  }, [loadSessions, sessionUser]);

  const revokeSession = useCallback(async (session: AdminSession) => {
    if (!sessionUser || sessionActionId) return;
    setSessionActionId(session.id);
    setSessionsError("");
    try {
      await adminApi<void>(`/users/${sessionUser.id}/sessions/${session.id}`, { method: "DELETE" });
      if (session.is_current) {
        // Revoking the current browser also ends this admin session. The auth
        // context clears the cookie and takes the user back to the login page.
        await logout();
        return;
      }
      setSessions((current) => current.filter((item) => item.id !== session.id));
      setMessage("Đã đăng xuất phiên trên thiết bị.");
    } catch (e: any) {
      setSessionsError("Không đăng xuất được phiên: " + (e?.message || "không rõ"));
    } finally {
      setSessionActionId(null);
    }
  }, [logout, sessionActionId, sessionUser]);

  if (!can(PERMISSIONS.usersView)) return <div className="p-8 text-center text-muted">403 — Bạn không có quyền quản lý người dùng.</div>;

  return <div className="lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 lg:shrink-0">
      <div><h2 className="text-2xl font-bold text-brand-teal">Người dùng</h2><p className="text-sm text-muted">Quản lý tài khoản Lark, tài khoản tạo trực tiếp và khách check-in theo workshop, thời gian.</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={loading} onClick={() => { setSuccessMessage(""); setAccountModal({ mode: "create" }); }} className="min-h-11 bg-brand-teal text-white px-3 py-2 rounded-sm text-sm font-semibold disabled:opacity-60">Tạo tài khoản</button>
        <button disabled={syncing} onClick={() => void syncDirectory()} className="min-h-11 bg-brand text-brand-teal px-3 py-2 rounded-sm text-sm font-semibold disabled:opacity-60">{syncing ? "Đang đồng bộ…" : "Đồng bộ danh bạ Lark"}</button>
        <button onClick={() => void load()} className="min-h-11 border border-line px-3 py-2 rounded-sm text-sm">Làm mới</button>
      </div>
    </div>
    {syncStatus && <div role="status" aria-live="polite" className="mb-4 border border-line bg-surface-muted rounded-sm p-3 text-sm text-muted lg:shrink-0">
      <span className="font-medium text-foreground">Danh bạ Lark: </span>
      {syncStatus.status === "never" ? "chưa đồng bộ" : syncStatus.status === "running" ? "đang đồng bộ" : syncStatus.status === "error" ? "đồng bộ lỗi" : "đã đồng bộ"}
      {syncStatus.finished_at && <> lúc {new Date(syncStatus.finished_at).toLocaleString("vi-VN")}</>}
      {syncStatus.status === "success" && <> · {syncStatus.users_seen} người · tạo {syncStatus.users_created} · cập nhật {syncStatus.users_updated} · khóa {syncStatus.users_deactivated}</>}
      {syncStatus.error && <div className="mt-1 text-red-700">{syncStatus.error}</div>}
    </div>}
    {successMessage && <div role="status" className="mb-3 p-3 bg-green-50 text-green-800 rounded-sm text-sm">{successMessage}</div>}
    {message && <div role="alert" className="mb-3 p-3 bg-red-50 text-red-700 rounded-sm text-sm">{message}</div>}
    <div className="mb-3 flex flex-col sm:flex-row sm:items-center gap-2 lg:shrink-0">
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
      <select aria-label="Loại tài khoản" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="min-h-11 border border-line bg-surface px-3 rounded-sm text-sm"><option value="">Tất cả loại tài khoản</option><option value="lark">Lark</option><option value="local">Tạo trực tiếp</option><option value="checkin_guest">Khách check-in</option></select>
      <ColumnVisibilityMenu columns={TABLE_COLUMNS} visible={visibleColumns} onChange={setVisibleColumns} />
      <div ref={larkFilterRef} className="relative">
        <button
          type="button"
          onClick={() => { setShowLarkFilterMenu((current) => !current); setShowApplicationFilterMenu(false); }}
          aria-expanded={showLarkFilterMenu}
          className="min-h-11 w-full sm:w-auto border border-line bg-surface px-3 py-2 rounded-sm text-sm inline-flex items-center justify-center gap-2 hover:bg-surface-muted"
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
          className="min-h-11 w-full sm:w-auto border border-line bg-surface px-3 py-2 rounded-sm text-sm inline-flex items-center justify-center gap-2 hover:bg-surface-muted"
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
    <div className="admin-table-scroll admin-users-table-scroll bg-surface border border-line rounded-md">
      {loading ? <div className="p-6 text-muted text-sm">Đang tải…</div> : <table className="w-full min-w-max text-sm">
        <thead className="text-muted"><tr>
          {visibleColumns.name && <th className="text-left p-3 sticky top-0 z-10 bg-surface-muted">Người dùng</th>}
          {visibleColumns.email && <th className="text-left p-3 sticky top-0 z-10 bg-surface-muted">Email đăng nhập</th>}
          {visibleColumns.enterpriseEmail && <th className="text-left p-3 sticky top-0 z-10 bg-surface-muted">Email doanh nghiệp</th>}
          {visibleColumns.lark && <th className="text-left p-3 sticky top-0 z-10 bg-surface-muted">Lark</th>}
          {visibleColumns.role && <th className="text-left p-3 sticky top-0 z-10 bg-surface-muted">Vai trò</th>}
          {visibleColumns.application && <th className="text-center p-3 sticky top-0 z-10 bg-surface-muted">Ứng dụng</th>}
          {visibleColumns.access && <th className="text-left p-3 sticky top-0 z-10 bg-surface-muted">Quyền khách check-in</th>}
          {visibleColumns.accountActions && <th className="text-left p-3 sticky top-0 z-10 bg-surface-muted">Quản lý tài khoản</th>}
          {visibleColumns.lastLogin && <th className="text-left p-3 sticky top-0 z-10 bg-surface-muted">Đăng nhập gần nhất</th>}
        </tr></thead>
        <tbody className="divide-y divide-line">{filteredUsers.map((user) => <tr key={user.id}>
          {visibleColumns.name && <td className="p-3 font-medium">{user.name || "Chưa có tên"}<span className="mt-1 block text-xs font-normal text-muted">{user.account_type === "checkin_guest" ? "Khách check-in" : user.account_type === "local" ? "Tạo trực tiếp" : "Lark"}</span></td>}
          {visibleColumns.email && <td className="p-3">{user.account_type === "checkin_guest" ? user.username : user.email}</td>}
          {visibleColumns.enterpriseEmail && <td className="p-3">{user.enterprise_email || "—"}</td>}
          {visibleColumns.lark && <td className="p-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs ${user.lark_account_status === "active" ? "bg-green-100 text-green-700" : user.lark_account_status && user.lark_account_status !== "unknown" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>{user.account_type && user.account_type !== "lark" ? "Không dùng Lark" : larkStatusLabel(user.lark_account_status)}</span></td>}
          {visibleColumns.role && <td className="p-3">{user.account_type === "checkin_guest" ? <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-800">Chỉ check-in</span> : <select disabled={saving === user.id} value={user.role} onChange={(e) => void update(user, { role: e.target.value })} className="min-h-11 border border-line rounded-sm px-2 py-1" aria-label={`Vai trò của ${user.name || user.email}`}>
            {roles.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>}</td>}
          {visibleColumns.application && <td className="p-3 text-center">{user.role === "super_admin" ? (
            <span className="inline-flex px-2 py-1 rounded-full text-xs bg-green-100 text-green-700" title="Tài khoản super_admin luôn hoạt động">Luôn hoạt động</span>
          ) : (
            <button disabled={saving === user.id} onClick={() => void update(user, { is_active: !user.is_active })} className={`min-h-11 px-3 py-1 rounded-full text-xs ${user.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{user.is_active ? user.account_type === "checkin_guest" ? "Đã bật" : "Hoạt động" : "Đã khóa"}</button>
          )}</td>}
          {visibleColumns.access && <td className="p-3 text-xs">{user.account_type === "checkin_guest" ? <div className="max-w-64 whitespace-normal space-y-1">
            <div className="font-semibold text-brand-teal">{workshops.find((workshop) => workshop.id === user.access_workshop_id)?.name || "Workshop không còn tồn tại"}</div>
            <div>{formatDateTime(user.access_starts_at)} → {formatDateTime(user.access_expires_at)}</div>
            <span className="block font-medium">{guestStatus(user)}</span>
          </div> : "—"}</td>}
          {visibleColumns.accountActions && <td className="p-3">{user.account_type === "local" || user.account_type === "checkin_guest" ? <div className="flex flex-col items-start gap-1">
            <button type="button" onClick={() => setAccountModal({ mode: "edit", user })} className="min-h-9 text-brand-teal hover:underline">{user.account_type === "checkin_guest" ? "Sửa username / quyền" : "Sửa tên"}</button>
            <button type="button" onClick={() => setAccountModal({ mode: "password", user })} className="min-h-9 text-brand-teal hover:underline">Đặt lại mật khẩu</button>
          </div> : "Quản lý qua Lark"}</td>}
          {visibleColumns.lastLogin && <td className="p-3 text-muted">
            <button
              type="button"
              onClick={() => openSessions(user)}
              className="group min-h-11 py-1 text-left"
              aria-label={`Xem lịch sử phiên đăng nhập của ${user.name || user.username || user.email}`}
            >
              <span className="block text-brand-teal group-hover:underline">{user.last_login_at ? formatDateTime(user.last_login_at) : "Chưa đăng nhập"}</span>
              <span className="mt-0.5 block text-xs text-brand-teal">Xem các thiết bị →</span>
            </button>
          </td>}
        </tr>)}</tbody>
      </table>}
      {!loading && !filteredUsers.length && !message && <div className="p-6 text-center text-muted text-sm">{search ? "Không tìm thấy người dùng phù hợp." : "Chưa có người dùng phù hợp. Bạn có thể tạo tài khoản hoặc đồng bộ danh bạ Lark."}</div>}
    </div>
    {accountModal && <AccountManagementModal state={accountModal} roles={roles} onClose={() => setAccountModal(null)} onSaved={(savedUser, feedback) => {
      if (savedUser) setUsers((current) => current.some((item) => item.id === savedUser.id) ? current.map((item) => item.id === savedUser.id ? savedUser : item) : [savedUser, ...current]);
      setNow(Date.now());
      setMessage("");
      setSuccessMessage(feedback);
      if (accountModal.mode === "password" && accountModal.user.id === authUser?.id) void logout();
      setAccountModal(null);
    }} />}
    {sessionUser && <LoginSessionsModal
      user={sessionUser}
      sessions={sessions}
      loading={sessionsLoading}
      error={sessionsError}
      actionId={sessionActionId}
      onClose={closeSessions}
      onRefresh={refreshSessions}
      onRevoke={(session) => void revokeSession(session)}
    />}
  </div>;
}
