"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { adminApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { useOutsidePointerDown } from "@/hooks/useOutsidePointerDown";
import AccountManagementModal, { type AccountModalState, type ManagedAccount } from "./AccountManagementModal";
import { formatDateTime, LoginSessionsModal, type AdminSession } from "./LoginSessionsModal";

interface Workshop { id: string; name: string; status?: string; event_date?: string | null; }
interface Role { key: string; label: string; }
interface Membership { user_id: string; workshop_id: string; role: string; }
type StatusFilter = "active" | "inactive" | "";
type SortKey = "name" | "lastLogin";

const GLOBAL_ROLES = new Set(["admin", "super_admin"]);
const ACCOUNT_TYPES = [
  { value: "lark", label: "Tài khoản Lark" },
  { value: "local", label: "Tạo trực tiếp" },
  { value: "checkin_guest", label: "Khách check-in" },
];

interface DirectorySyncStatus {
  status: "never" | "running" | "success" | "error";
  finished_at?: string | null;
  users_seen: number;
  users_created: number;
  users_updated: number;
  users_deactivated: number;
  error?: string | null;
}

interface MenuItem { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string; }
const VISIBLE_WORKSHOP_CHIPS = 2;

const LARK_STATUS: Record<string, { label: string; className: string }> = {
  active: { label: "Đang hoạt động", className: "bg-green-50 text-green-800 ring-green-200" },
  inactive: { label: "Chưa kích hoạt", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  frozen: { label: "Đã đóng băng", className: "bg-red-50 text-red-700 ring-red-200" },
  resigned: { label: "Đã nghỉ việc", className: "bg-red-50 text-red-700 ring-red-200" },
  unknown: { label: "Không rõ", className: "bg-gray-50 text-gray-600 ring-gray-200" },
};

const LOGIN_METHOD: Record<string, string> = {
  lark: "Lark SSO",
  local: "Email + mật khẩu",
  checkin_guest: "Username + mật khẩu",
};

const isGlobalAdmin = (user: ManagedAccount) => user.account_type !== "checkin_guest" && GLOBAL_ROLES.has(user.role);
const displayName = (user: ManagedAccount) => user.name || user.email || user.username || "Người dùng";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function initials(user: ManagedAccount): string {
  const words = (user.name || user.email || user.username || "?").trim().split(/\s+/);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2);
  return letters.toLocaleUpperCase("vi");
}

const relativeFormat = new Intl.RelativeTimeFormat("vi", { numeric: "auto" });
function relativeTime(value?: string | null): string {
  if (!value) return "";
  const diff = new Date(value).getTime() - Date.now();
  if (Number.isNaN(diff)) return "";
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 60) return relativeFormat.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeFormat.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return relativeFormat.format(days, "day");
  const months = Math.round(days / 30);
  return Math.abs(months) < 12 ? relativeFormat.format(months, "month") : relativeFormat.format(Math.round(months / 12), "year");
}

/**
 * body có thể đặt CSS zoom (vd 0.9 trên màn hình rộng). getBoundingClientRect trả về toạ độ đã zoom,
 * còn top/left của phần tử fixed bên trong body tính theo toạ độ chưa zoom, nên phải quy đổi.
 */
function zoomedViewport(element: HTMLElement) {
  const zoom = parseFloat(getComputedStyle(document.body).zoom || "1") || 1;
  const rect = element.getBoundingClientRect();
  return {
    rect: { top: rect.top / zoom, bottom: rect.bottom / zoom, left: rect.left / zoom, right: rect.right / zoom },
    width: window.innerWidth / zoom,
    height: window.innerHeight / zoom,
  };
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}>{children}</span>;
}

function StatusBadge({ active }: { active: boolean }) {
  return <Badge className={active ? "bg-green-50 text-green-800 ring-green-200" : "bg-red-50 text-red-700 ring-red-200"}>
    <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${active ? "bg-green-600" : "bg-red-500"}`} />
    {active ? "Hoạt động" : "Đã khóa"}
  </Badge>;
}

function Chip({ children, tone = "default", title }: { children: React.ReactNode; tone?: "default" | "brand" | "amber"; title?: string }) {
  const tones = {
    default: "bg-surface-muted text-text-secondary",
    brand: "bg-brand/15 text-brand-teal",
    amber: "bg-amber-50 text-amber-800",
  };
  // Nhãn dài được cắt gọn; toàn bộ danh sách xem được qua nút "+N" / "Phân quyền".
  return <span title={title} className={`inline-flex min-w-0 max-w-48 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}><span className="truncate">{children}</span></span>;
}

function Avatar({ user }: { user: ManagedAccount }) {
  return <span aria-hidden className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold ${user.is_active ? "bg-brand/15 text-brand-teal" : "bg-gray-100 text-gray-500"}`}>{initials(user)}</span>;
}

function SortHeader({ label, sortKey, sort, onSort }: { label: string; sortKey: SortKey; sort: { key: SortKey; dir: "asc" | "desc" }; onSort: (key: SortKey) => void }) {
  const active = sort.key === sortKey;
  return <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className="whitespace-nowrap px-2 py-2 font-semibold 2xl:px-3">
    <button type="button" onClick={() => onSort(sortKey)} className="inline-flex min-h-8 items-center gap-1 rounded hover:text-ink">
      {label}
      <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`h-3.5 w-3.5 transition-transform ${active ? "text-ink" : "opacity-40"} ${active && sort.dir === "desc" ? "rotate-180" : ""}`}><path d="m6 15 6-6 6 6" /></svg>
    </button>
  </th>;
}

/**
 * Sửa quyền workshop của một người ngay tại ô "Workshop": khung nổi gắn với ô trên màn hình rộng,
 * khung trượt từ dưới lên trên mobile. Lưu một lần cho cả vai trò mọi workshop lẫn từng workshop.
 */
function WorkshopAccessEditor({
  user, anchor, workshops, roles, memberships, onClose, onSaved,
}: {
  user: ManagedAccount;
  anchor: HTMLElement;
  workshops: Workshop[];
  roles: Role[];
  memberships: Membership[];
  onClose: () => void;
  onSaved: (user: ManagedAccount, memberships: Membership[]) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const defaultRole = roles.find((role) => role.key === "viewer")?.key || roles[0]?.key || "";
  const [allRole, setAllRole] = useState(user.all_workshops_role || "");
  const [assigned, setAssigned] = useState<Record<string, string>>(() => Object.fromEntries(memberships.map((item) => [item.workshop_id, item.role])));
  const [newRole, setNewRole] = useState(defaultRole);
  const [search, setSearch] = useState("");
  const [onlyAssigned, setOnlyAssigned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [viewport, setViewport] = useState(() => zoomedViewport(anchor));
  const [sheet, setSheet] = useState(() => window.innerWidth < 640);

  const original = useMemo(() => Object.fromEntries(memberships.map((item) => [item.workshop_id, item.role])), [memberships]);
  const assignedCount = Object.keys(assigned).length;
  const dirty = allRole !== (user.all_workshops_role || "") || JSON.stringify(Object.entries(assigned).sort()) !== JSON.stringify(Object.entries(original).sort());

  // Bám theo ô khi bảng hoặc trang cuộn, thay vì đóng và làm mất thay đổi đang sửa.
  useEffect(() => {
    const update = () => { setViewport(zoomedViewport(anchor)); setSheet(window.innerWidth < 640); };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [anchor]);

  useEffect(() => { panelRef.current?.querySelector<HTMLElement>("input, select, button")?.focus(); }, []);

  const close = useCallback(() => {
    if (saving) return;
    if (dirty && !window.confirm("Bỏ các thay đổi quyền workshop chưa lưu?")) return;
    onClose();
    anchor.focus();
  }, [anchor, dirty, onClose, saving]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchor.contains(target)) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onPointer); };
  }, [anchor, close]);

  const term = search.trim().toLocaleLowerCase("vi");
  const visible = useMemo(() => workshops
    .filter((workshop) => (!onlyAssigned || assigned[workshop.id]) && (!term || workshop.name.toLocaleLowerCase("vi").includes(term)))
    // Workshop đang có quyền lên đầu để thấy ngay khi mở.
    .sort((a, b) => Number(Boolean(original[b.id])) - Number(Boolean(original[a.id]))), [assigned, onlyAssigned, original, term, workshops]);

  const toggle = (workshopId: string, checked: boolean) => setAssigned((current) => {
    const next = { ...current };
    if (checked) next[workshopId] = original[workshopId] || newRole;
    else delete next[workshopId];
    return next;
  });

  const save = async () => {
    setSaving(true);
    setError("");
    const items = Object.entries(assigned).map(([workshop_id, role]) => ({ workshop_id, role }));
    try {
      const updated = await adminApi<ManagedAccount>(`/users/${encodeURIComponent(user.id)}/workshop-access`, {
        method: "PUT",
        body: JSON.stringify({ all_workshops_role: allRole || null, memberships: items }),
      });
      onSaved(updated, items.map((item) => ({ ...item, user_id: user.id })));
    } catch (saveError) {
      setError(errorMessage(saveError, "Không thể lưu quyền workshop."));
      setSaving(false);
    }
  };

  const { rect } = viewport;
  const width = 440;
  const spaceBelow = viewport.height - rect.bottom - 12;
  const spaceAbove = rect.top - 12;
  const above = spaceBelow < 360 && spaceAbove > spaceBelow;
  const maxHeight = Math.min(560, Math.max(300, above ? spaceAbove : spaceBelow));
  const left = Math.min(Math.max(12, rect.left), viewport.width - width - 12);
  const style: React.CSSProperties = sheet ? {} : { left, width, maxHeight, ...(above ? { bottom: viewport.height - rect.top + 6 } : { top: rect.bottom + 6 }) };
  const selectClass = "min-h-9 rounded-md border border-line bg-white px-2 text-sm disabled:bg-gray-50 disabled:text-muted";

  // Portal ra body để vị trí fixed không bị ảnh hưởng bởi khung cuộn/transform của bảng.
  return createPortal(<>
    {sheet && <div className="fixed inset-0 z-40 bg-black/40" aria-hidden />}
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={sheet}
      aria-labelledby="workshop-editor-title"
      style={style}
      className={`fixed z-50 flex flex-col overflow-hidden border border-line bg-white shadow-xl ${sheet ? "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-xl" : "rounded-lg"}`}
    >
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id="workshop-editor-title" className="text-sm font-bold text-ink">Vai trò tại workshop</h2>
          <p className="truncate text-xs text-muted">{displayName(user)}{!user.is_active ? " · tài khoản đang khóa" : ""}</p>
        </div>
        <button type="button" onClick={close} aria-label="Đóng" className="grid h-9 min-h-9 w-9 min-w-9 place-items-center rounded-full text-xl text-muted hover:bg-surface-muted">×</button>
      </header>

      <div className="space-y-3 border-b border-line px-4 py-3">
        {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-error">{error}</div>}
        <p className="text-xs text-muted">Quyết định người này làm được gì với dữ liệu trong workshop (khách mời, check-in, thống kê). Khác với <strong className="font-semibold text-text-secondary">vai trò hệ thống</strong> ở cột bên cạnh.</p>
        <label className="flex items-center gap-3 rounded-md bg-brand/5 px-3 py-2">
          <input type="checkbox" checked={Boolean(allRole)} disabled={saving} onChange={(event) => setAllRole(event.target.checked ? (user.all_workshops_role || defaultRole) : "")} className="h-4 w-4 accent-brand" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">Tất cả workshop</span>
            <span className="block text-xs text-muted">Kể cả workshop tạo sau</span>
          </span>
          <select aria-label="Vai trò tại mọi workshop" value={allRole || defaultRole} disabled={saving || !allRole} onChange={(event) => setAllRole(event.target.value)} className={selectClass}>
            {roles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
          </select>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm workshop" aria-label="Tìm workshop" className="min-h-9 w-full rounded-md border border-line pl-8 pr-2 text-sm outline-none focus:border-brand" />
          </div>
          <label className="flex shrink-0 items-center justify-between gap-1.5 text-xs text-muted" title="Vai trò gán cho workshop được tick mới">
            Vai trò mới
            <select aria-label="Vai trò cho workshop được chọn mới" value={newRole} disabled={saving} onChange={(event) => setNewRole(event.target.value)} className={selectClass}>
              {roles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
            </select>
          </label>
        </div>
        <div className="flex items-center justify-between text-xs text-muted">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={onlyAssigned} onChange={(event) => setOnlyAssigned(event.target.checked)} className="h-3.5 w-3.5 accent-brand" />
            Chỉ hiện workshop đã gán
          </label>
          <span>Đã gán riêng <strong className="tabular-nums text-ink">{assignedCount}</strong>/{workshops.length}</span>
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto py-1" aria-label="Danh sách workshop">
        {visible.length ? visible.map((workshop) => {
          const role = assigned[workshop.id];
          const changed = role !== original[workshop.id];
          return <li key={workshop.id} className={`flex items-center gap-3 px-4 py-1.5 ${role ? "bg-brand/[0.04]" : ""}`}>
            <input id={`ws-${workshop.id}`} type="checkbox" checked={Boolean(role)} disabled={saving} onChange={(event) => toggle(workshop.id, event.target.checked)} className="h-4 w-4 shrink-0 accent-brand" />
            <label htmlFor={`ws-${workshop.id}`} className="min-w-0 flex-1 cursor-pointer text-sm text-ink">
              <span className="line-clamp-2">{workshop.name}</span>
              {changed && <span className="text-[11px] font-medium text-amber-700">{!original[workshop.id] ? "Thêm mới" : !role ? "Sẽ thu hồi" : "Đổi vai trò"}</span>}
            </label>
            {role && <select aria-label={`Vai trò tại ${workshop.name}`} value={role} disabled={saving} onChange={(event) => setAssigned((current) => ({ ...current, [workshop.id]: event.target.value }))} className={`${selectClass} shrink-0`}>
              {roles.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>}
            {!role && original[workshop.id] && <span className="shrink-0 text-[11px] font-medium text-red-700">Sẽ thu hồi</span>}
          </li>;
        }) : <li className="px-4 py-6 text-center text-sm text-muted">Không có workshop phù hợp.</li>}
      </ul>

      <footer className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
        <span className="text-xs text-muted" aria-live="polite">{dirty ? "Có thay đổi chưa lưu" : "Chưa thay đổi"}</span>
        <div className="flex gap-2">
          <button type="button" onClick={close} disabled={saving} className="min-h-10 rounded-md border border-line px-3 text-sm font-semibold hover:bg-surface-muted">Hủy</button>
          <button type="button" onClick={() => void save()} disabled={saving || !dirty} className="min-h-10 rounded-md bg-brand px-4 text-sm font-semibold text-brand-teal disabled:opacity-40">{saving ? "Đang lưu…" : "Lưu"}</button>
        </div>
      </footer>
    </div>
  </>, document.body);
}

function AddMembersDialog({
  workshop, candidates, roles, onClose, onAdd,
}: {
  workshop: Workshop;
  candidates: ManagedAccount[];
  roles: Role[];
  onClose: () => void;
  onAdd: (userIds: string[], role: string) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, dialogRef);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [role, setRole] = useState(roles.find((item) => item.key === "viewer")?.key || roles[0]?.key || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const term = search.trim().toLocaleLowerCase("vi");
  const visible = candidates.filter((user) => !term || [user.name, user.email, user.enterprise_email].some((value) => value?.toLocaleLowerCase("vi").includes(term)));
  const selectedSet = new Set(selected);
  const allVisibleSelected = visible.length > 0 && visible.every((user) => selectedSet.has(user.id));

  const close = useCallback(() => {
    if (saving) return;
    if (selected.length && !window.confirm("Bỏ danh sách người đã chọn?")) return;
    onClose();
  }, [onClose, saving, selected.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      await onAdd(selected, role);
    } catch (addError) {
      setError(errorMessage(addError, "Không thêm được người dùng."));
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="add-members-title" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialogRef} tabIndex={-1} className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-xl bg-white shadow-xl sm:rounded-xl">
      <header className="flex items-start gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 id="add-members-title" className="font-heading text-lg font-bold text-ink">Thêm người vào workshop</h2>
          <p className="truncate text-sm text-muted">{workshop.name}</p>
        </div>
        <button type="button" onClick={close} aria-label="Đóng" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-2xl text-muted hover:bg-surface-muted">×</button>
      </header>
      <div className="space-y-3 border-b border-line p-4">
        {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-error">{error}</div>}
        <div className="relative">
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm tên hoặc email" aria-label="Tìm người dùng để thêm" className="min-h-11 w-full rounded-md border border-line pl-9 pr-3 text-sm outline-none focus:border-brand" />
        </div>
        <div className="flex items-center justify-between text-xs text-muted">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={allVisibleSelected} disabled={!visible.length || saving} onChange={(event) => setSelected((current) => event.target.checked ? Array.from(new Set([...current, ...visible.map((user) => user.id)])) : current.filter((id) => !visible.some((user) => user.id === id)))} className="h-4 w-4 accent-brand" />
            Chọn tất cả đang hiển thị
          </label>
          <span>Đã chọn <strong className="text-ink">{selected.length}</strong></span>
        </div>
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto" aria-label="Người dùng có thể thêm">
        {visible.length ? visible.map((user) => <li key={user.id}>
          <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-surface-muted/60">
            <input type="checkbox" checked={selectedSet.has(user.id)} disabled={saving} onChange={(event) => setSelected((current) => event.target.checked ? [...current, user.id] : current.filter((id) => id !== user.id))} className="h-4 w-4 accent-brand" />
            <Avatar user={user} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{user.name || user.email}</span>
              <span className="block truncate text-xs text-muted">{user.email}{user.all_workshops_role ? " · đã có quyền mọi workshop" : ""}</span>
            </span>
            {!user.is_active && <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-muted">Đã khóa</span>}
          </label>
        </li>) : <li className="p-6 text-center text-sm text-muted">{term ? "Không có người dùng khớp tìm kiếm." : "Mọi người dùng đều đã có trong workshop."}</li>}
      </ul>
      <footer className="flex flex-col gap-2 border-t border-line px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm text-text-secondary">Vai trò
          <select value={role} disabled={saving} onChange={(event) => setRole(event.target.value)} className="min-h-11 rounded-md border border-line bg-white px-2 text-sm">
            {roles.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={close} disabled={saving} className="min-h-11 flex-1 rounded-md border border-line px-4 text-sm font-semibold hover:bg-surface-muted sm:flex-none">Hủy</button>
          <button type="button" onClick={() => void submit()} disabled={saving || !selected.length || !role} className="min-h-11 flex-1 rounded-md bg-brand px-5 text-sm font-semibold text-brand-teal disabled:opacity-40 sm:flex-none">{saving ? "Đang thêm…" : `Thêm ${selected.length || ""} người`}</button>
        </div>
      </footer>
    </div>
  </div>;
}

/** Menu thao tác của một dòng; định vị cố định để không bị khung cuộn của bảng cắt mất. */
function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setPosition(null), []);
  useOutsidePointerDown(menuRef, useCallback(() => setPosition(null), []), Boolean(position));

  useEffect(() => {
    if (!position) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { close(); buttonRef.current?.focus(); }
    };
    // Đóng khi cuộn để menu không trôi khỏi nút.
    window.addEventListener("scroll", close, true);
    document.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("scroll", close, true); document.removeEventListener("keydown", onKey); };
  }, [close, position]);

  const toggle = () => {
    if (position) { close(); return; }
    if (!buttonRef.current) return;
    const { rect, width, height: viewportHeight } = zoomedViewport(buttonRef.current);
    const height = items.length * 44 + 12;
    const top = rect.bottom + height + 8 > viewportHeight ? Math.max(8, rect.top - height - 4) : rect.bottom + 4;
    setPosition({ top, right: width - rect.right });
  };

  return <>
    <button ref={buttonRef} type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={Boolean(position)} aria-label={label} className="grid h-10 w-10 place-items-center rounded-md border border-line text-muted hover:border-brand hover:text-ink">
      <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
    </button>
    {position && createPortal(<div ref={menuRef} role="menu" aria-label={label} style={{ top: position.top, right: position.right }} className="fixed z-40 w-60 rounded-md border border-line bg-white p-1.5 text-left shadow-lg">
      {items.map((item) => <button key={item.label} type="button" role="menuitem" disabled={item.disabled} title={item.hint} onClick={() => { close(); item.onSelect(); }} className={`flex min-h-11 w-full items-center rounded px-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${item.danger ? "text-red-700 hover:bg-red-50" : "text-ink hover:bg-surface-muted"}`}>{item.label}</button>)}
    </div>, document.body)}
  </>;
}

export default function UserAccessTable() {
  const { user: authUser, can, refresh, logout } = useAuth();
  const allowed = can(PERMISSIONS.usersView);
  const canManage = can(PERMISSIONS.usersManage);
  const [users, setUsers] = useState<ManagedAccount[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [savingMember, setSavingMember] = useState<string | null>(null);
  const [addingMembers, setAddingMembers] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [accountModal, setAccountModal] = useState<AccountModalState | null>(null);
  const [syncStatus, setSyncStatus] = useState<DirectorySyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [workshopFilter, setWorkshopFilter] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const [editing, setEditing] = useState<{ user: ManagedAccount; anchor: HTMLElement } | null>(null);
  const [sessionUser, setSessionUser] = useState<ManagedAccount | null>(null);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError("");
    try {
      const [people, ws, catalog, members, status] = await Promise.all([
        adminApi<ManagedAccount[]>("/users"),
        adminApi<Workshop[]>("/workshops"),
        adminApi<{ roles: Role[] }>("/users/catalog"),
        adminApi<Membership[]>("/workshops/memberships"),
        adminApi<DirectorySyncStatus>("/users/directory-sync/status").catch(() => null),
      ]);
      setUsers(people);
      setSyncStatus(status);
      setWorkshops(ws);
      setRoles(catalog.roles);
      setMemberships(members);
    } catch (loadError) {
      setError(errorMessage(loadError, "Không tải được danh sách người dùng."));
    } finally {
      setLoading(false);
    }
  }, [allowed]);
  useEffect(() => { void load(); }, [load]);

  // Thông báo thành công tự ẩn để không chiếm chỗ của bảng.
  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(""), 4000);
    return () => window.clearTimeout(timer);
  }, [success]);

  const workshopRoles = useMemo(() => roles.filter((role) => role.key !== "super_admin"), [roles]);
  const roleLabel = useCallback((key?: string | null) => roles.find((role) => role.key === key)?.label || key || "", [roles]);
  const workshopName = useCallback((id?: string | null) => workshops.find((workshop) => workshop.id === id)?.name || "Workshop đã xóa", [workshops]);
  const membershipsByUser = useMemo(() => {
    const map = new Map<string, Membership[]>();
    for (const membership of memberships) map.set(membership.user_id, [...(map.get(membership.user_id) || []), membership]);
    return map;
  }, [memberships]);

  const hasWorkshopAccess = useCallback((user: ManagedAccount, workshopId: string) => {
    if (user.account_type === "checkin_guest") return Boolean(user.access_all_workshops || user.access_workshop_ids?.includes(workshopId) || user.access_workshop_id === workshopId);
    if (isGlobalAdmin(user) || user.all_workshops_role) return true;
    return Boolean(membershipsByUser.get(user.id)?.some((membership) => membership.workshop_id === workshopId));
  }, [membershipsByUser]);

  // Áp dụng mọi bộ lọc trừ trạng thái, để nút trạng thái hiển thị số lượng đúng theo các bộ lọc còn lại.
  const matchesOtherFilters = useCallback((user: ManagedAccount) => {
    const term = search.trim().toLocaleLowerCase("vi");
    if (typeFilter && (user.account_type || "lark") !== typeFilter) return false;
    if (roleFilter && (user.account_type === "checkin_guest" || user.role !== roleFilter)) return false;
    if (workshopFilter && !hasWorkshopAccess(user, workshopFilter)) return false;
    return !term || [user.name, user.email, user.username, user.enterprise_email].some((value) => value?.toLocaleLowerCase("vi").includes(term));
  }, [hasWorkshopAccess, roleFilter, search, typeFilter, workshopFilter]);

  const statusCounts = useMemo(() => {
    const base = users.filter(matchesOtherFilters);
    return { active: base.filter((user) => user.is_active).length, inactive: base.filter((user) => !user.is_active).length, all: base.length };
  }, [matchesOtherFilters, users]);

  const filtered = useMemo(() => {
    const direction = sort.dir === "asc" ? 1 : -1;
    return users
      .filter((user) => (!statusFilter || (user.is_active ? "active" : "inactive") === statusFilter) && matchesOtherFilters(user))
      .sort((a, b) => {
        if (sort.key === "lastLogin") {
          const left = a.last_login_at ? Date.parse(a.last_login_at) : 0;
          const right = b.last_login_at ? Date.parse(b.last_login_at) : 0;
          if (left !== right) return (left - right) * direction;
        }
        return displayName(a).localeCompare(displayName(b), "vi") * (sort.key === "name" ? direction : 1);
      });
  }, [matchesOtherFilters, sort, statusFilter, users]);

  const filtersActive = Boolean(search || roleFilter || typeFilter || statusFilter !== "active" || workshopFilter);
  const resetFilters = () => { setSearch(""); setRoleFilter(""); setTypeFilter(""); setStatusFilter("active"); setWorkshopFilter(""); };

  const syncDirectory = async () => {
    setSyncing(true);
    setError("");
    setSuccess("");
    try {
      const status = await adminApi<DirectorySyncStatus>("/users/directory-sync", { method: "POST" });
      setSyncStatus(status);
      setSuccess(`Đồng bộ Lark xong: ${status.users_seen} tài khoản, tạo ${status.users_created}, khóa ${status.users_deactivated}.`);
      await load();
    } catch (syncError) {
      setError(errorMessage(syncError, "Không đồng bộ được danh bạ Lark."));
    } finally {
      setSyncing(false);
    }
  };

  const toggleActive = async (user: ManagedAccount) => {
    const locking = user.is_active;
    if (locking && !window.confirm(`Khóa tài khoản ${displayName(user)}? Mọi phiên đăng nhập của người này sẽ bị đăng xuất.`)) return;
    setTogglingId(user.id);
    setError("");
    setSuccess("");
    try {
      const updated = await adminApi<ManagedAccount>(`/users/${encodeURIComponent(user.id)}`, { method: "PATCH", body: JSON.stringify({ is_active: !locking }) });
      setUsers((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated, active_session_count: locking ? 0 : item.active_session_count } : item));
      setSuccess(locking ? `Đã khóa tài khoản ${displayName(user)}.` : `Đã mở khóa tài khoản ${displayName(user)}.`);
    } catch (toggleError) {
      setError(errorMessage(toggleError, "Không cập nhật được trạng thái tài khoản."));
    } finally {
      setTogglingId(null);
    }
  };
  const toggleSort = (key: SortKey) => setSort((current) => current.key === key
    ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
    : { key, dir: key === "lastLogin" ? "desc" : "asc" });

  const updateRole = async (user: ManagedAccount, role: string) => {
    const promotes = GLOBAL_ROLES.has(role) && !GLOBAL_ROLES.has(user.role);
    if (promotes && !window.confirm(`Đổi ${displayName(user)} thành “${roleLabel(role)}”? Vai trò này truy cập mọi workshop và có quyền quản trị hệ thống.`)) return;
    setSavingRole(user.id);
    setError("");
    setSuccess("");
    try {
      const updated = await adminApi<ManagedAccount>(`/users/${encodeURIComponent(user.id)}`, { method: "PATCH", body: JSON.stringify({ role }) });
      setUsers((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      setSuccess(`Đã đổi vai trò của ${displayName(user)} thành “${roleLabel(role)}”.`);
    } catch (roleError) {
      setError(errorMessage(roleError, "Không đổi được vai trò."));
    } finally {
      setSavingRole(null);
    }
  };

  const loadSessions = useCallback(async (userId: string) => {
    setSessionsLoading(true);
    setSessionsError("");
    try {
      setSessions(await adminApi<AdminSession[]>(`/users/${encodeURIComponent(userId)}/sessions`));
    } catch (sessionError) {
      setSessionsError(errorMessage(sessionError, "Không tải được lịch sử phiên đăng nhập."));
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const openSessions = (user: ManagedAccount) => {
    setSessionUser(user);
    setSessions([]);
    void loadSessions(user.id);
  };

  const revokeSession = async (session: AdminSession) => {
    if (!sessionUser || sessionActionId) return;
    setSessionActionId(session.id);
    setSessionsError("");
    try {
      await adminApi<void>(`/users/${encodeURIComponent(sessionUser.id)}/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      if (session.is_current) { await logout(); return; }
      setSessions((current) => current.filter((item) => item.id !== session.id));
      setUsers((current) => current.map((item) => item.id === sessionUser.id ? { ...item, active_session_count: Math.max(0, (item.active_session_count || 1) - 1) } : item));
    } catch (sessionError) {
      setSessionsError(errorMessage(sessionError, "Không đăng xuất được phiên."));
    } finally {
      setSessionActionId(null);
    }
  };

  const userCell = (user: ManagedAccount) => <div className="flex min-w-0 items-center gap-3">
    <Avatar user={user} />
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 font-semibold text-ink">
        <span className="break-words">{user.name || "Chưa có tên"}</span>
        {user.id === authUser?.id && <span className="rounded bg-surface-muted px-1.5 text-[11px] font-medium text-muted">Bạn</span>}
      </div>
      <div className="truncate text-xs text-muted" title={user.enterprise_email || user.email || undefined}>{user.enterprise_email && user.enterprise_email !== user.email ? user.enterprise_email : user.account_type === "checkin_guest" ? "Khách check-in" : user.account_type === "local" ? "Tài khoản tạo trực tiếp" : "Tài khoản Lark"}</div>
    </div>
  </div>;

  const loginCell = (user: ManagedAccount) => {
    const identifier = user.account_type === "checkin_guest" ? user.username : user.email;
    return <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-semibold text-text-secondary">{LOGIN_METHOD[user.account_type || "lark"]}</span>
        <span className="min-w-0 truncate font-mono text-xs text-ink" title={identifier || undefined}>{identifier || "—"}</span>
      </div>
      <button type="button" onClick={() => openSessions(user)} className="inline-flex min-h-6 flex-wrap items-center gap-x-2 text-left text-xs text-muted hover:text-brand-teal" aria-label={`Xem phiên đăng nhập của ${displayName(user)}`}>
        <span title={user.last_login_at ? formatDateTime(user.last_login_at) : undefined}>{user.last_login_at ? `Đăng nhập ${relativeTime(user.last_login_at)}` : "Chưa đăng nhập"}</span>
        {user.active_session_count ? <span className="inline-flex items-center gap-1 font-medium text-green-800"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-green-600" />{user.active_session_count} phiên</span> : null}
        <span aria-hidden className="text-brand-teal">›</span>
      </button>
    </div>;
  };

  const larkCell = (user: ManagedAccount) => {
    if (user.account_type !== "lark") return <span className="text-xs text-muted">Không dùng Lark</span>;
    const status = LARK_STATUS[user.lark_account_status || "unknown"];
    return <Badge className={status.className}>{status.label}</Badge>;
  };

  const roleCell = (user: ManagedAccount) => user.account_type === "checkin_guest"
    ? <Chip tone="amber">Chỉ check-in</Chip>
    : <>
      <label className="sr-only" htmlFor={`role-${user.id}`}>Vai trò hệ thống của {displayName(user)}</label>
      <select id={`role-${user.id}`} value={user.role} disabled={!canManage || savingRole === user.id || user.id === authUser?.id} title={user.id === authUser?.id ? "Không tự đổi vai trò của chính mình" : undefined} onChange={(event) => void updateRole(user, event.target.value)} className="min-h-10 w-full min-w-32 max-w-44 rounded-md border border-line bg-white px-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-muted">
        {roles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
      </select>
    </>;

  // Chế độ workshop: khi lọc theo một workshop, quản lý thành viên của workshop đó ngay trên bảng.
  const selectedWorkshop = workshops.find((workshop) => workshop.id === workshopFilter) || null;
  // Quản trị toàn hệ thống và khách check-in không được gán riêng; bản ghi cũ của họ được giữ nguyên.
  const unmanagedUserIds = useMemo(() => new Set(users.filter((user) => user.account_type === "checkin_guest" || isGlobalAdmin(user)).map((user) => user.id)), [users]);
  const directMembers = useMemo(() => workshopFilter
    ? memberships.filter((membership) => membership.workshop_id === workshopFilter && !unmanagedUserIds.has(membership.user_id))
    : [], [memberships, unmanagedUserIds, workshopFilter]);
  const memberRole = (userId: string) => directMembers.find((membership) => membership.user_id === userId)?.role;
  const addCandidates = useMemo(() => users
    .filter((user) => user.account_type !== "checkin_guest" && !isGlobalAdmin(user) && !directMembers.some((membership) => membership.user_id === user.id))
    .sort((a, b) => Number(b.is_active) - Number(a.is_active) || displayName(a).localeCompare(displayName(b), "vi")), [directMembers, users]);
  const hiddenInactiveInWorkshop = selectedWorkshop && statusFilter === "active" ? statusCounts.inactive : 0;

  const saveWorkshopMembers = async (next: { user_id: string; role: string }[]) => {
    if (!selectedWorkshop) return;
    const data = await adminApi<{ members: { user_id: string; role: string }[] }>(`/workshops/${encodeURIComponent(selectedWorkshop.id)}/members`, {
      method: "PUT", body: JSON.stringify({ members: next }),
    });
    const workshopId = selectedWorkshop.id;
    setMemberships((current) => [
      ...current.filter((membership) => membership.workshop_id !== workshopId || unmanagedUserIds.has(membership.user_id)),
      ...data.members.map((member) => ({ ...member, workshop_id: workshopId })),
    ]);
  };

  const changeMember = async (user: ManagedAccount, role: string | null) => {
    if (!selectedWorkshop) return;
    if (!role && !window.confirm(`Thu hồi quyền của ${displayName(user)} tại “${selectedWorkshop.name}”?${user.all_workshops_role ? " Người này vẫn giữ vai trò tại mọi workshop." : ""}`)) return;
    setSavingMember(user.id);
    setError("");
    setSuccess("");
    try {
      const base = directMembers.map(({ user_id, role: memberRoleKey }) => ({ user_id, role: memberRoleKey }));
      await saveWorkshopMembers(role ? base.map((item) => item.user_id === user.id ? { ...item, role } : item) : base.filter((item) => item.user_id !== user.id));
      setSuccess(role ? `Đã đổi vai trò của ${displayName(user)} tại workshop thành “${roleLabel(role)}”.` : `Đã thu hồi quyền của ${displayName(user)} tại workshop.`);
      if (user.id === authUser?.id) void refresh();
    } catch (memberError) {
      setError(errorMessage(memberError, "Không cập nhật được thành viên workshop."));
    } finally {
      setSavingMember(null);
    }
  };

  const addMembers = async (userIds: string[], role: string) => {
    const base = directMembers.map(({ user_id, role: memberRoleKey }) => ({ user_id, role: memberRoleKey }));
    await saveWorkshopMembers([...base, ...userIds.map((user_id) => ({ user_id, role }))]);
    setAddingMembers(false);
    setSuccess(`Đã thêm ${userIds.length} người vào “${selectedWorkshop?.name}” với vai trò “${roleLabel(role)}”.`);
    if (authUser && userIds.includes(authUser.id)) void refresh();
  };

  const workshopRoleCell = (user: ManagedAccount) => {
    if (user.account_type === "checkin_guest") return <div className="space-y-1"><Chip tone="amber">Khách check-in</Chip><div className="text-xs text-muted">{formatDateTime(user.access_starts_at)} → {formatDateTime(user.access_expires_at)}</div></div>;
    if (isGlobalAdmin(user)) return <Chip tone="brand">Quản trị · mọi workshop</Chip>;
    const own = memberRole(user.id);
    if (!own) return <Chip tone="brand">Mọi workshop · {roleLabel(user.all_workshops_role)}</Chip>;
    return <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`member-role-${user.id}`}>Vai trò của {displayName(user)} tại workshop</label>
        <select id={`member-role-${user.id}`} value={own} disabled={savingMember === user.id} onChange={(event) => void changeMember(user, event.target.value)} className="min-h-10 min-w-36 rounded-md border border-line bg-white px-2 text-sm disabled:bg-gray-50">
          {workshopRoles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
        </select>
        <button type="button" disabled={savingMember === user.id} onClick={() => void changeMember(user, null)} className="min-h-10 rounded-md px-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40" aria-label={`Thu hồi ${displayName(user)} khỏi workshop`}>Thu hồi</button>
      </div>
      {user.all_workshops_role && <div className="text-xs text-muted">Kèm vai trò mọi workshop: {roleLabel(user.all_workshops_role)}</div>}
    </div>;
  };
  const workshopColumn = (user: ManagedAccount) => selectedWorkshop ? workshopRoleCell(user) : workshopCell(user);
  const workshopColumnLabel = selectedWorkshop ? "Vai trò tại workshop" : "Workshop";

  const workshopCell = (user: ManagedAccount) => {
    if (user.account_type === "checkin_guest") {
      return <div className="space-y-1">
        {user.access_all_workshops ? <Chip tone="amber">Tất cả workshop</Chip> : (() => {
          const ids = user.access_workshop_ids?.length ? user.access_workshop_ids : user.access_workshop_id ? [user.access_workshop_id] : [];
          if (!ids.length) return <Chip tone="amber">Chưa có workshop</Chip>;
          return <div className="flex flex-wrap gap-1.5">
            {ids.slice(0, VISIBLE_WORKSHOP_CHIPS).map((id) => <Chip key={id} tone="amber" title={workshopName(id)}>{workshopName(id)}</Chip>)}
            {ids.length > VISIBLE_WORKSHOP_CHIPS && <Chip tone="amber" title={ids.slice(VISIBLE_WORKSHOP_CHIPS).map((id) => workshopName(id)).join(", ")}>+{ids.length - VISIBLE_WORKSHOP_CHIPS} workshop</Chip>}
          </div>;
        })()}
        <div className="text-xs text-muted">{formatDateTime(user.access_starts_at)} → {formatDateTime(user.access_expires_at)}</div>
      </div>;
    }
    if (isGlobalAdmin(user)) return <Chip tone="brand">Tất cả workshop · quản trị</Chip>;
    const own = membershipsByUser.get(user.id) || [];
    const hidden = own.length - VISIBLE_WORKSHOP_CHIPS;
    const summary = <>
      {user.all_workshops_role && <Chip tone="brand">Tất cả workshop · {roleLabel(user.all_workshops_role)}</Chip>}
      {own.slice(0, VISIBLE_WORKSHOP_CHIPS).map((membership) => <Chip key={membership.workshop_id} title={`${workshopName(membership.workshop_id)} · ${roleLabel(membership.role)}`}>{workshopName(membership.workshop_id)} · {roleLabel(membership.role)}</Chip>)}
      {hidden > 0 && <Chip title={own.slice(VISIBLE_WORKSHOP_CHIPS).map((membership) => workshopName(membership.workshop_id)).join(", ")}>+{hidden} workshop</Chip>}
      {!user.all_workshops_role && !own.length && <span className="text-xs text-muted">Chưa có workshop</span>}
    </>;
    if (!canManage) return <div className="flex flex-wrap items-center gap-1.5">{summary}</div>;
    const open = editing?.user.id === user.id;
    // Cả ô là nút mở trình sửa, để sửa quyền workshop ngay tại bảng.
    return <button
      type="button"
      onClick={(event) => setEditing(open ? null : { user, anchor: event.currentTarget })}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Sửa quyền workshop của ${displayName(user)}`}
      className={`group flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-left transition-colors ${open ? "border-brand bg-brand/5" : "border-transparent hover:border-line hover:bg-surface-muted/60"}`}
    >
      {summary}
      <span aria-hidden className={`ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-teal ${open ? "" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
        Sửa
      </span>
    </button>;
  };

  const actions = (user: ManagedAccount) => {
    if (!canManage) return null;
    const self = user.id === authUser?.id;
    const items: MenuItem[] = [
      { label: "Xem phiên đăng nhập", onSelect: () => openSessions(user) },
      ...(user.account_type === "local" ? [{ label: "Sửa tên", onSelect: () => setAccountModal({ mode: "edit", user }) }] : []),
      ...(user.account_type === "checkin_guest" ? [{ label: "Sửa username / thời gian check-in", onSelect: () => setAccountModal({ mode: "edit", user }) }] : []),
      ...(user.account_type === "local" || user.account_type === "checkin_guest" ? [{ label: "Đặt lại mật khẩu", onSelect: () => setAccountModal({ mode: "password", user }) }] : []),
      {
        label: user.is_active ? "Khóa tài khoản" : "Mở khóa tài khoản",
        onSelect: () => void toggleActive(user),
        danger: user.is_active,
        disabled: togglingId === user.id || user.role === "super_admin" || self,
        hint: user.role === "super_admin" ? "Tài khoản Quản trị cấp cao luôn hoạt động" : self ? "Không tự khóa tài khoản của chính mình" : undefined,
      },
    ];
    return <div className="flex items-center justify-end gap-2">
      <RowMenu label={`Thao tác với ${displayName(user)}`} items={items} />
    </div>;
  };

  if (!allowed) return <div className="p-8 text-center text-muted">403 — Bạn không có quyền quản lý người dùng.</div>;

  const selectClass = "min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm";
  const statusOptions: { value: StatusFilter; label: string; count: number }[] = [
    { value: "active", label: "Hoạt động", count: statusCounts.active },
    { value: "inactive", label: "Đã khóa", count: statusCounts.inactive },
    { value: "", label: "Tất cả", count: statusCounts.all },
  ];

  return <div className="space-y-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-4 lg:space-y-0">
    <div className="flex flex-col gap-3 lg:shrink-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="font-heading text-2xl font-bold text-ink">Người dùng</h2>
        <p className="mt-1 text-sm text-muted">Tài khoản, trạng thái, thông tin đăng nhập, vai trò và các workshop mỗi người được truy cập.</p>
        {syncStatus && <p className="mt-1 text-xs text-muted" aria-live="polite">
          Danh bạ Lark: {syncStatus.status === "never" ? "chưa đồng bộ" : syncStatus.status === "running" ? "đang đồng bộ…" : syncStatus.status === "error" ? <span className="text-error">đồng bộ lỗi{syncStatus.error ? ` — ${syncStatus.error}` : ""}</span> : "đã đồng bộ"}
          {syncStatus.finished_at && syncStatus.status !== "running" && <> · {relativeTime(syncStatus.finished_at)}</>}
        </p>}
      </div>
      {canManage && <div className="flex shrink-0 flex-wrap gap-2">
        <button type="button" disabled={loading} onClick={() => { setSuccess(""); setAccountModal({ mode: "create" }); }} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-brand-teal px-4 text-sm font-semibold text-white disabled:opacity-50">
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M12 5v14M5 12h14" /></svg>
          Tạo tài khoản
        </button>
        <button type="button" disabled={syncing} onClick={() => void syncDirectory()} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-brand-teal hover:bg-surface-muted disabled:opacity-50">
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`h-4 w-4 ${syncing ? "animate-spin motion-reduce:animate-none" : ""}`}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>
          {syncing ? "Đang đồng bộ…" : "Đồng bộ danh bạ Lark"}
        </button>
      </div>}
    </div>

    <div className="flex flex-col gap-2 lg:shrink-0 2xl:flex-row 2xl:items-center">
      <div role="group" aria-label="Lọc theo trạng thái tài khoản" className="inline-flex w-full self-start rounded-lg border border-line bg-white p-1 sm:w-auto">
        {statusOptions.map((option) => {
          const active = statusFilter === option.value;
          return <button key={option.label} type="button" aria-pressed={active} onClick={() => setStatusFilter(option.value)} className={`inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-sm font-semibold transition-colors sm:flex-none sm:px-3 ${active ? "bg-brand-teal text-white" : "text-muted hover:bg-surface-muted hover:text-ink"}`}>
            {option.label}
            <span className={`rounded-full px-1.5 text-xs tabular-nums ${active ? "bg-white/20" : "bg-surface-muted"}`}>{option.count}</span>
          </button>;
        })}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row">
      <div className="flex min-w-0 flex-1 gap-2">
        <div className="relative min-w-0 flex-1">
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm tên, email, username…" aria-label="Tìm người dùng" className="min-h-11 w-full rounded-md border border-line bg-white pl-9 pr-3 text-sm outline-none focus:border-brand" />
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-brand-teal hover:bg-surface-muted disabled:opacity-50" aria-label="Làm mới danh sách" title="Làm mới">
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>
          <span className="hidden 2xl:inline">Làm mới</span>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:flex">
        <select aria-label="Lọc theo loại tài khoản" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className={`${selectClass} min-w-0 md:w-40`}>
          <option value="">Mọi loại</option>
          {ACCOUNT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
        </select>
        <select aria-label="Lọc theo vai trò" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className={`${selectClass} min-w-0 md:w-40`}>
          <option value="">Mọi vai trò hệ thống</option>
          {roles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
        </select>
        <select aria-label="Lọc theo workshop" value={workshopFilter} onChange={(event) => setWorkshopFilter(event.target.value)} className={`${selectClass} col-span-2 min-w-0 sm:col-span-1 md:w-56`}>
          <option value="">Mọi workshop</option>
          {workshops.map((workshop) => <option key={workshop.id} value={workshop.id}>{workshop.name}</option>)}
        </select>
      </div>
      </div>
    </div>

    <div className="flex min-h-6 flex-wrap items-center justify-between gap-2 text-xs text-muted lg:shrink-0" aria-live="polite">
      <span>Hiển thị <strong className="tabular-nums text-ink">{filtered.length}</strong> / {users.length} tài khoản</span>
      {filtersActive && <button type="button" onClick={resetFilters} className="font-semibold text-brand-teal underline">Đặt lại bộ lọc</button>}
    </div>

    {selectedWorkshop && canManage && <div className="flex flex-col gap-3 rounded-lg border border-brand/30 bg-brand/5 p-4 lg:shrink-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-teal">Đang quản lý workshop</p>
        <p className="truncate font-semibold text-ink">{selectedWorkshop.name}</p>
        <p className="text-xs text-muted">
          {directMembers.length} người được gán riêng · đổi vai trò hoặc thu hồi ngay trên bảng
          {hiddenInactiveInWorkshop > 0 && <> · <button type="button" onClick={() => setStatusFilter("")} className="font-semibold text-brand-teal underline">hiện cả {hiddenInactiveInWorkshop} tài khoản đã khóa</button></>}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={() => setWorkshopFilter("")} className="min-h-11 rounded-md border border-line bg-white px-3 text-sm font-semibold text-muted hover:text-ink">Bỏ chọn</button>
        <button type="button" onClick={() => setAddingMembers(true)} disabled={loading || !workshopRoles.length} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-brand-teal px-4 text-sm font-semibold text-white disabled:opacity-40">
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M12 5v14M5 12h14" /></svg>
          Thêm người
        </button>
      </div>
    </div>}

    {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-error lg:shrink-0"><span>{error}</span><button type="button" onClick={() => void load()} className="font-semibold underline">Thử lại</button></div>}
    {success && <div role="status" className="rounded-md border border-success-border bg-success-soft p-3 text-sm text-success lg:shrink-0">{success}</div>}

    {/* Màn hình rộng: bảng. Hẹp hơn: danh sách thẻ để không phải cuộn ngang. */}
    <div className="admin-table-scroll admin-users-table-scroll hidden rounded-lg border border-line bg-white xl:block">
      <table className="w-full text-sm">
        <caption className="sr-only">Danh sách người dùng, trạng thái và quyền truy cập workshop</caption>
        <thead className="text-left text-xs text-muted">
          <tr>
            <SortHeader label="User" sortKey="name" sort={sort} onSort={toggleSort} />
            <th scope="col" className="whitespace-nowrap px-2 py-2 font-semibold 2xl:px-3">Trạng thái Lark</th>
            <th scope="col" className="whitespace-nowrap px-2 py-2 font-semibold 2xl:px-3">Trạng thái</th>
            <th scope="col" className="whitespace-nowrap px-2 py-2 font-semibold 2xl:px-3" title="Quyền chức năng chung: tạo workshop, cài đặt, mẫu tin… Không cấp quyền vào dữ liệu workshop, trừ Quản trị viên và Quản trị cấp cao (tự có mọi workshop).">Vai trò hệ thống</th>
            <th scope="col" className="whitespace-nowrap px-2 py-2 font-semibold 2xl:px-3">{workshopColumnLabel}</th>
            <SortHeader label="Đăng nhập" sortKey="lastLogin" sort={sort} onSort={toggleSort} />
            <th scope="col" className="px-2 py-2 2xl:px-3"><span className="sr-only">Thao tác</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {loading ? [1, 2, 3, 4, 5].map((row) => <tr key={row}>{[1, 2, 3, 4, 5, 6, 7].map((cell) => <td key={cell} className="px-3 py-4"><div className="h-4 animate-pulse rounded bg-surface-muted" /></td>)}</tr>) : filtered.map((user) => <tr key={user.id} className={`transition-colors hover:bg-brand/[0.03] ${user.is_active ? "" : "text-muted"}`}>
            <td className="w-52 max-w-52 px-2 py-3 2xl:px-3">{userCell(user)}</td>
            <td className="px-2 py-3 2xl:px-3">{larkCell(user)}</td>
            <td className="px-2 py-3 2xl:px-3"><StatusBadge active={user.is_active} /></td>
            <td className="px-2 py-3 2xl:px-3">{roleCell(user)}</td>
            <td className="min-w-48 px-2 py-3 2xl:px-3">{workshopColumn(user)}</td>
            <td className="w-52 max-w-52 px-2 py-3 2xl:px-3">{loginCell(user)}</td>
            <td className="px-2 py-3 text-right 2xl:px-3">{actions(user)}</td>
          </tr>)}
        </tbody>
      </table>
      {!loading && !filtered.length && <EmptyState filtersActive={filtersActive} onReset={resetFilters} />}
    </div>

    <ul className="grid gap-3 md:grid-cols-2 lg:min-h-0 lg:flex-1 lg:content-start lg:overflow-y-auto xl:hidden" aria-label="Danh sách người dùng">
      {loading ? [1, 2, 3].map((item) => <li key={item} className="h-40 animate-pulse rounded-lg bg-surface-muted" />) : filtered.map((user) => <li key={user.id} className="min-w-0 space-y-3 rounded-lg border border-line bg-white p-4">
        <div className="flex items-start justify-between gap-3">{userCell(user)}<StatusBadge active={user.is_active} /></div>
        <dl className="grid grid-cols-[6rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
          <dt className="text-xs text-muted">Lark</dt><dd>{larkCell(user)}</dd>
          <dt className="text-xs text-muted">Vai trò hệ thống</dt><dd>{roleCell(user)}</dd>
          <dt className="self-start pt-0.5 text-xs text-muted">{selectedWorkshop ? "Tại workshop" : "Workshop"}</dt><dd>{workshopColumn(user)}</dd>
          <dt className="self-start pt-0.5 text-xs text-muted">Đăng nhập</dt><dd className="min-w-0">{loginCell(user)}</dd>
        </dl>
        {canManage && <div className="border-t border-line pt-3">{actions(user)}</div>}
      </li>)}
      {!loading && !filtered.length && <li className="md:col-span-2"><EmptyState filtersActive={filtersActive} onReset={resetFilters} /></li>}
    </ul>

    {accountModal && <AccountManagementModal state={accountModal} roles={roles} onClose={() => setAccountModal(null)} onSaved={(saved, feedback) => {
      if (saved) setUsers((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? { ...item, ...saved } : item) : [saved, ...current]);
      setError("");
      setSuccess(feedback);
      if (accountModal.mode === "password" && accountModal.user.id === authUser?.id) void logout();
      setAccountModal(null);
    }} />}
    {addingMembers && selectedWorkshop && <AddMembersDialog
      workshop={selectedWorkshop}
      candidates={addCandidates}
      roles={workshopRoles}
      onClose={() => setAddingMembers(false)}
      onAdd={addMembers}
    />}
    {editing && <WorkshopAccessEditor
      key={editing.user.id}
      user={editing.user}
      anchor={editing.anchor}
      workshops={workshops}
      roles={workshopRoles}
      memberships={membershipsByUser.get(editing.user.id) || []}
      onClose={() => setEditing(null)}
      onSaved={(updated, next) => {
        setUsers((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
        setMemberships((current) => [...current.filter((item) => item.user_id !== updated.id), ...next]);
        setSuccess(`Đã lưu quyền workshop của ${displayName(updated)}.`);
        setEditing(null);
        if (updated.id === authUser?.id) void refresh();
      }}
    />}
    {sessionUser && <LoginSessionsModal
      user={sessionUser}
      sessions={sessions}
      loading={sessionsLoading}
      error={sessionsError}
      actionId={sessionActionId}
      onClose={() => { if (!sessionActionId) setSessionUser(null); }}
      onRefresh={() => void loadSessions(sessionUser.id)}
      onRevoke={(session) => void revokeSession(session)}
    />}
  </div>;
}

function EmptyState({ filtersActive, onReset }: { filtersActive: boolean; onReset: () => void }) {
  return <div className="px-4 py-12 text-center">
    <p className="font-semibold text-ink">Không có tài khoản phù hợp</p>
    <p className="mt-1 text-sm text-muted">{filtersActive ? "Thử đổi từ khóa hoặc bộ lọc." : "Chưa có tài khoản nào."}</p>
    {filtersActive && <button type="button" onClick={onReset} className="mt-3 min-h-11 rounded-md border border-line px-4 text-sm font-semibold text-brand-teal hover:bg-surface-muted">Đặt lại bộ lọc</button>}
  </div>;
}
