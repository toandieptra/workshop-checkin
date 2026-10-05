"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { adminApi } from "@/lib/api";
import { useDialogFocus } from "@/hooks/useDialogFocus";

export interface ManagedAccount {
  id: string;
  name?: string | null;
  email: string | null;
  username?: string | null;
  role: string;
  is_active: boolean;
  account_type?: "lark" | "local" | "checkin_guest";
  access_workshop_id?: string | null;
  access_starts_at?: string | null;
  access_expires_at?: string | null;
  enterprise_email?: string | null;
  lark_account_status?: "active" | "inactive" | "frozen" | "resigned" | "unknown" | null;
  lark_last_synced_at?: string | null;
  last_login_at?: string | null;
}

export interface AccountWorkshop { id: string; name: string; }
interface RoleOption { key: string; label: string; }
export type AccountModalState = { mode: "create" } | { mode: "edit" | "password"; user: ManagedAccount };

interface Props {
  state: AccountModalState;
  roles: RoleOption[];
  onClose: () => void;
  onSaved: (user: ManagedAccount | null, message: string) => void;
}

function localDateTime(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

const inputClass = "mt-1 min-h-11 w-full rounded-sm border border-line bg-white px-3 py-2 text-sm font-normal text-ink disabled:bg-surface-muted disabled:text-muted";

export default function AccountManagementModal({ state, roles, onClose, onSaved }: Props) {
  const user = state.mode === "create" ? null : state.user;
  const passwordOnly = state.mode === "password";
  const [accountType, setAccountType] = useState<"local" | "checkin_guest">(user?.account_type === "checkin_guest" ? "checkin_guest" : "local");
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [username, setUsername] = useState(user?.username || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(user?.role || "user");
  const [workshopId, setWorkshopId] = useState(user?.access_workshop_id || "");
  const [startsAt, setStartsAt] = useState(() => localDateTime(user?.access_starts_at || new Date()));
  const [expiresAt, setExpiresAt] = useState(() => localDateTime(user?.access_expires_at || new Date(Date.now() + 8 * 60 * 60 * 1000)));
  const [workshops, setWorkshops] = useState<AccountWorkshop[]>([]);
  const [workshopsLoading, setWorkshopsLoading] = useState(false);
  const [workshopsError, setWorkshopsError] = useState("");
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, dialogRef, passwordOnly ? "#account-password" : "#account-name");
  const isGuest = accountType === "checkin_guest";
  const needsPassword = passwordOnly || state.mode === "create";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const title = passwordOnly ? "Đặt lại mật khẩu" : state.mode === "create" ? "Tạo tài khoản" : isGuest ? "Sửa tài khoản khách check-in" : "Sửa tài khoản";

  const close = () => {
    if (saving) return;
    setPassword("");
    onClose();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        setPassword("");
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  useEffect(() => {
    if (!isGuest || passwordOnly) return;
    let active = true;
    setWorkshopsLoading(true);
    setWorkshopsError("");
    adminApi<AccountWorkshop[]>("/workshops").then((data) => {
      if (active) setWorkshops(data);
    }).catch((err: unknown) => {
      if (active) setWorkshopsError(err instanceof Error ? err.message : "Không tải được workshop.");
    }).finally(() => { if (active) setWorkshopsLoading(false); });
    return () => { active = false; };
  }, [isGuest, passwordOnly, reload]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setError("");
    if (needsPassword && (password.length < 12 || password.length > 128)) {
      setError("Mật khẩu cần từ 12 đến 128 ký tự.");
      return;
    }
    const changes: Record<string, unknown> = { name: name.trim() };
    if (!passwordOnly) {
      if (!name.trim()) { setError("Vui lòng nhập tên người dùng."); return; }
      if (state.mode === "create" && !isGuest && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setError("Vui lòng nhập email hợp lệ.");
        return;
      }
      if (isGuest) {
        const normalized = username.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalized)) {
          setError("Username cần 3–64 ký tự: chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang; bắt đầu bằng chữ hoặc số.");
          return;
        }
        changes.username = normalized;
        if (!workshopId || !workshops.some((item) => item.id === workshopId)) {
          setError("Vui lòng chọn một workshop.");
          return;
        }
        const start = new Date(startsAt);
        const end = new Date(expiresAt);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
          setError("Thời gian kết thúc phải sau thời gian bắt đầu.");
          return;
        }
        const scopeChanged = state.mode === "create" || workshopId !== user?.access_workshop_id
          || startsAt !== localDateTime(user?.access_starts_at || "") || expiresAt !== localDateTime(user?.access_expires_at || "");
        if (scopeChanged && end.getTime() <= Date.now()) {
          setError("Thời gian kết thúc phải nằm trong tương lai.");
          return;
        }
        if (scopeChanged) {
          changes.access_workshop_id = workshopId;
          changes.access_starts_at = start.toISOString();
          changes.access_expires_at = end.toISOString();
        }
      } else if (state.mode === "create") {
        changes.role = role;
      }
    }
    setSaving(true);
    try {
      if (passwordOnly && user) {
        await adminApi(`/users/${encodeURIComponent(user.id)}/password`, { method: "PUT", body: JSON.stringify({ password }) });
        setPassword("");
        onSaved(null, "Đã đặt lại mật khẩu và đăng xuất tất cả phiên của tài khoản.");
      } else {
        const created = state.mode === "create";
        const updated = await adminApi<ManagedAccount>(created ? "/users" : `/users/${encodeURIComponent(user!.id)}`, {
          method: created ? "POST" : "PATCH",
          body: JSON.stringify(created ? { ...changes, ...(!isGuest ? { email: email.trim() } : {}), password, account_type: accountType, is_active: true } : changes),
        });
        setPassword("");
        onSaved(updated, created ? isGuest ? "Đã tạo tài khoản khách check-in theo workshop và thời gian đã chọn." : "Đã tạo tài khoản. Hãy cấp quyền tại mục Quyền theo workshop nếu cần." : "Đã cập nhật tài khoản.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được tài khoản. Vui lòng thử lại.");
    } finally { setSaving(false); }
  };

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={close}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="account-modal-title" tabIndex={-1} onClick={(event) => event.stopPropagation()} className="flex max-h-[94dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-xl sm:rounded-md">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div><h2 id="account-modal-title" className="text-lg font-semibold text-brand-teal">{title}</h2>{user && <p className="mt-1 break-all text-xs text-muted">{user.account_type === "checkin_guest" ? user.username : user.email}</p>}</div>
        <button type="button" disabled={saving} onClick={close} aria-label="Đóng" className="min-h-11 min-w-11 text-xl text-muted disabled:opacity-50">×</button>
      </div>
      <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          {error && <div role="alert" className="rounded-sm border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {state.mode === "create" && <fieldset disabled={saving}><legend className="mb-2 text-sm font-semibold">Loại tài khoản</legend><div className="grid gap-2 sm:grid-cols-2">{([{ value: "local", label: "Tài khoản riêng", detail: "Đăng nhập bằng email và mật khẩu." }, { value: "checkin_guest", label: "Khách check-in có thời hạn", detail: "Đăng nhập bằng username; check-in một workshop trong thời gian được cấp." }] as const).map((option) => <label key={option.value} className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${accountType === option.value ? "border-brand bg-brand/5" : "border-line"}`}><input type="radio" name="account-type" value={option.value} checked={accountType === option.value} onChange={() => { setAccountType(option.value); setError(""); }} className="mt-1 accent-brand" /><span><span className="block font-semibold">{option.label}</span><span className="mt-1 block text-xs text-muted">{option.detail}</span></span></label>)}</div></fieldset>}
          {!passwordOnly && <>
            <label className="block text-sm font-semibold" htmlFor="account-name">Tên người dùng<input id="account-name" value={name} onChange={(event) => setName(event.target.value)} disabled={saving} required maxLength={200} autoComplete="off" className={inputClass} /></label>
            {isGuest && <label className="block text-sm font-semibold" htmlFor="account-username">Username được cấp<input id="account-username" type="text" required minLength={3} maxLength={64} value={username} onChange={(event) => setUsername(event.target.value)} disabled={saving} autoComplete="off" autoCapitalize="none" spellCheck={false} className={inputClass} /><span className="mt-1 block text-xs font-normal text-muted">Không cần email. Dùng 3–64 ký tự gồm chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang. Username không phân biệt hoa/thường.</span></label>}
            {state.mode === "create" && !isGuest && <label className="block text-sm font-semibold" htmlFor="account-email">Email đăng nhập<input id="account-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={saving} required maxLength={254} autoComplete="off" autoCapitalize="none" spellCheck={false} className={inputClass} /></label>}
          </>}
          {needsPassword && <label className="block text-sm font-semibold" htmlFor="account-password">{passwordOnly ? "Mật khẩu mới" : "Mật khẩu"}<input id="account-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={saving} required minLength={12} maxLength={128} autoComplete="new-password" aria-describedby="account-password-help" className={inputClass} /><span id="account-password-help" className="mt-1 block text-xs font-normal text-muted">Từ 12 đến 128 ký tự. Mật khẩu không hiển thị lại sau khi lưu.</span></label>}
          {passwordOnly ? <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Sau khi đặt lại mật khẩu, tất cả phiên đăng nhập của tài khoản sẽ được đăng xuất. Người dùng cần đăng nhập lại bằng mật khẩu mới.</p> : isGuest ? <>
            <div className="rounded-md border border-line bg-surface-muted p-3 text-sm text-muted">Tài khoản khách chỉ xem danh sách khách và check-in tại workshop đã chọn. Quyền tự hết hiệu lực khi đến thời gian kết thúc.</div>
            <label className="block text-sm font-semibold" htmlFor="account-workshop">Workshop<select id="account-workshop" value={workshopId} onChange={(event) => setWorkshopId(event.target.value)} required disabled={saving || workshopsLoading || Boolean(workshopsError)} className={inputClass}><option value="">{workshopsLoading ? "Đang tải workshop…" : "Chọn một workshop"}</option>{workshops.map((workshop) => <option key={workshop.id} value={workshop.id}>{workshop.name}</option>)}</select></label>
            {workshopsError && <div role="alert" className="text-sm text-red-700">{workshopsError}<button type="button" disabled={saving} onClick={() => setReload((value) => value + 1)} className="ml-2 underline">Thử lại</button></div>}
            {!workshopsLoading && !workshopsError && !workshops.length && <p className="text-sm text-muted">Chưa có workshop. Hãy tạo workshop trước khi tạo tài khoản khách.</p>}
            <div className="grid gap-3 sm:grid-cols-2"><label className="block min-w-0 text-sm font-semibold" htmlFor="account-start">Bắt đầu<input id="account-start" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required disabled={saving} className={inputClass} /></label><label className="block min-w-0 text-sm font-semibold" htmlFor="account-end">Kết thúc<input id="account-end" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} required disabled={saving} className={inputClass} /></label></div>
            <p className="text-xs text-muted">Thời gian theo múi giờ thiết bị: {timezone}. Tài khoản chỉ đăng nhập được trong khoảng thời gian này.</p>
          </> : state.mode === "create" && <>
            <label className="block text-sm font-semibold" htmlFor="account-role">Vai trò toàn hệ thống<select id="account-role" value={role} onChange={(event) => setRole(event.target.value)} disabled={saving} className={inputClass}>{roles.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
            <p className="text-sm text-muted">{role === "admin" || role === "super_admin" ? "Quản trị viên toàn hệ thống được truy cập mọi workshop theo quyền chức năng của vai trò." : <>Sau khi tạo, cấp vai trò tại từng workshop trong <Link href="/admin/cai-dat?tab=phan-quyen" className="font-medium text-brand-teal underline" onClick={(event) => { if (saving) event.preventDefault(); }}>Phân quyền → Quyền theo workshop</Link>.</>}</p>
          </>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          <button type="button" disabled={saving} onClick={close} className="min-h-11 rounded-sm border border-line px-4 text-sm disabled:opacity-50">Hủy</button>
          <button type="submit" disabled={saving || (!passwordOnly && isGuest && (workshopsLoading || Boolean(workshopsError) || !workshops.length))} className="min-h-11 rounded-sm bg-brand px-4 text-sm font-semibold text-brand-teal disabled:opacity-50">{saving ? "Đang lưu…" : passwordOnly ? "Đặt lại mật khẩu" : state.mode === "create" ? "Tạo tài khoản" : "Lưu thay đổi"}</button>
        </div>
      </form>
    </div>
  </div>;
}
