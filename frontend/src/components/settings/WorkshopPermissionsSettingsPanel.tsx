"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";

interface Workshop { id: string; name: string; status: string; }
interface ManagedUser { id: string; name?: string | null; email: string; role: string; is_active: boolean; account_type?: string; }
interface Role { key: string; label: string; }
interface Member { user_id: string; role: string; }
interface MembersResponse { members: Member[]; inherited_user_ids: string[]; }
const memberKey = (members: Member[]) => JSON.stringify([...members].sort((a, b) => a.user_id.localeCompare(b.user_id)));

export default function WorkshopPermissionsSettingsPanel({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { can, refresh } = useAuth();
  const allowed = can(PERMISSIONS.usersManage);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [workshopId, setWorkshopId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [baseline, setBaseline] = useState("[]");
  const [inheritedIds, setInheritedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [membersReady, setMembersReady] = useState(false);
  const requestId = useRef(0);
  const dirty = memberKey(members) !== baseline;

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError("");
    try {
      const [ws, people, catalog] = await Promise.all([
        adminApi<Workshop[]>("/workshops"),
        adminApi<ManagedUser[]>("/users"),
        adminApi<{ roles: Role[] }>("/users/catalog"),
      ]);
      setWorkshops(ws);
      setUsers(people.filter((person) => person.account_type !== "checkin_guest"));
      setRoles(catalog.roles.filter((role) => role.key !== "super_admin"));
      setWorkshopId((id) => ws.some((workshop) => workshop.id === id) ? id : ws[0]?.id || "");
    } catch (err) { setError(err instanceof Error ? err.message : "Không tải được dữ liệu phân quyền."); }
    finally { setLoading(false); }
  }, [allowed]);
  useEffect(() => { void load(); }, [load]);

  const loadMembers = useCallback(async () => {
    const sequence = ++requestId.current;
    setMembers([]);
    setBaseline("[]");
    setInheritedIds([]);
    setMembersReady(false);
    setError("");
    setSuccess("");
    if (!workshopId || !allowed) return;
    setMembersLoading(true);
    try {
      const data = await adminApi<MembersResponse>(`/workshops/${encodeURIComponent(workshopId)}/members`);
      if (sequence !== requestId.current) return;
      setMembers(data.members);
      setBaseline(memberKey(data.members));
      setInheritedIds(data.inherited_user_ids);
      setMembersReady(true);
    } catch (err) {
      if (sequence === requestId.current) setError(err instanceof Error ? err.message : "Không tải được thành viên.");
    } finally { if (sequence === requestId.current) setMembersLoading(false); }
  }, [workshopId, allowed]);
  useEffect(() => { void loadMembers(); return () => { ++requestId.current; }; }, [loadMembers]);

  const inherited = useMemo(() => new Set([...inheritedIds, ...users.filter((person) => person.role === "admin" || person.role === "super_admin").map((person) => person.id)]), [inheritedIds, users]);
  const usersById = useMemo(() => new Map(users.map((person) => [person.id, person])), [users]);
  const matchesSearch = (person: ManagedUser) => `${person.name || ""} ${person.email}`.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi"));
  const availableUsers = users.filter((person) => !inherited.has(person.id) && !members.some((member) => member.user_id === person.id) && matchesSearch(person));
  const inheritedUsers = users.filter((person) => inherited.has(person.id) && matchesSearch(person));
  const visibleMembers = members.filter((member) => !inherited.has(member.user_id) && (!usersById.has(member.user_id) || matchesSearch(usersById.get(member.user_id)!)));
  const changeWorkshop = (id: string) => {
    if (dirty && !window.confirm("Bạn có thay đổi chưa lưu. Chuyển workshop và bỏ thay đổi?")) return;
    setWorkshopId(id);
    setSearch("");
  };
  const save = async () => {
    if (!workshopId || saving || !dirty || !membersReady) return;
    setSaving(true); setError(""); setSuccess("");
    try {
      const data = await adminApi<MembersResponse>(`/workshops/${encodeURIComponent(workshopId)}/members`, {
        method: "PUT", body: JSON.stringify({ members: members.filter((member) => !inherited.has(member.user_id)) }),
      });
      setMembers(data.members); setBaseline(memberKey(data.members)); setInheritedIds(data.inherited_user_ids);
      setSuccess("Đã lưu quyền theo workshop. Thay đổi có hiệu lực ở yêu cầu tiếp theo.");
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể lưu phân quyền."); }
    finally { setSaving(false); }
  };
  const personName = (person?: ManagedUser, id?: string) => person?.name || person?.email || id || "Người dùng";
  const identity = (person?: ManagedUser, id?: string) => <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink">{personName(person, id)}</span>{person && !person.is_active && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-muted">Đã khóa</span>}</div>{person?.email && <p className="break-all text-xs text-muted">{person.email}</p>}</div>;

  if (!allowed) return <div className="p-6 text-error">Bạn không có quyền quản lý phân quyền workshop.</div>;
  return <div className="min-h-0 space-y-4 lg:overflow-y-auto">
    <div><h2 className="font-heading text-xl font-bold text-ink">Quyền theo workshop</h2><p className="mt-1 text-sm text-muted">Mỗi người dùng có thể giữ vai trò khác nhau tại từng workshop. Chỉ các quyền liên quan workshop của vai trò được áp dụng.</p></div>
    <div className="rounded-lg border border-line bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 text-sm font-semibold">Workshop<select value={workshopId} onChange={(event) => changeWorkshop(event.target.value)} disabled={loading || saving} className="mt-1 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm font-normal"><option value="" disabled>{loading ? "Đang tải workshop…" : "Chọn workshop"}</option>{workshops.map((workshop) => <option key={workshop.id} value={workshop.id}>{workshop.name}</option>)}</select></label>
        <button type="button" disabled={loading || membersLoading || saving || !dirty || !membersReady} onClick={() => void save()} className="min-h-11 rounded-md bg-brand px-5 text-sm font-semibold text-brand-teal disabled:opacity-40">{saving ? "Đang lưu…" : "Lưu thay đổi"}</button>
      </div>
      {dirty && <p className="mt-2 text-xs text-amber-700">Có thay đổi chưa lưu.</p>}
      {error && <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-error">{error}<button type="button" disabled={saving} className="ml-3 underline" onClick={() => void (dirty && membersReady ? save() : workshopId ? loadMembers() : load())}>Thử lại</button></div>}
      {success && <div role="status" className="mt-3 rounded-md border border-success-border bg-success-soft p-3 text-sm text-success">{success}</div>}
      {!loading && !workshops.length && <p className="mt-4 text-sm text-muted">Chưa có workshop để cấp quyền.</p>}
      {membersLoading && <p role="status" className="py-8 text-center text-sm text-muted">Đang tải phân quyền workshop…</p>}
      {workshopId && membersReady && !membersLoading && <>
        <label className="mt-5 block text-sm font-semibold">Tìm người dùng<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tên hoặc email" className="mt-1 min-h-11 w-full rounded-md border border-line px-3 font-normal" /></label>
        <h3 className="mb-2 mt-5 text-sm font-bold text-ink">Thành viên workshop ({members.filter((member) => !inherited.has(member.user_id)).length})</h3>
        <div className="divide-y divide-line rounded-md border border-line">{visibleMembers.length ? visibleMembers.map((member) => <div key={member.user_id} className="flex flex-wrap items-center gap-3 p-3">{identity(usersById.get(member.user_id), member.user_id)}<label className="sr-only" htmlFor={`role-${member.user_id}`}>Vai trò của {personName(usersById.get(member.user_id), member.user_id)}</label><select id={`role-${member.user_id}`} value={member.role} disabled={saving} onChange={(event) => { setSuccess(""); setMembers((current) => current.map((item) => item.user_id === member.user_id ? { ...item, role: event.target.value } : item)); }} className="min-h-11 max-w-full rounded-md border border-line bg-white px-2 text-sm">{roles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}</select><button type="button" disabled={saving} className="min-h-11 text-sm text-red-600 disabled:opacity-40" onClick={() => { setSuccess(""); setMembers((current) => current.filter((item) => item.user_id !== member.user_id)); }}>Thu hồi</button></div>) : <p className="p-4 text-sm text-muted">{search ? "Không có thành viên khớp tìm kiếm." : "Chưa cấp quyền riêng cho người dùng nào."}</p>}</div>
        {inheritedUsers.length > 0 && <><h3 className="mb-2 mt-5 text-sm font-bold text-ink">Quản trị viên toàn hệ thống</h3><div className="divide-y divide-line rounded-md border border-line bg-surface-muted">{inheritedUsers.map((person) => <div key={person.id} className="flex flex-wrap items-center gap-3 p-3">{identity(person)}<span className="rounded-full bg-brand/15 px-3 py-1 text-xs font-semibold text-brand-teal">Truy cập mọi workshop</span></div>)}</div></>}
        <h3 className="mb-2 mt-5 text-sm font-bold text-ink">Thêm người dùng</h3>
        <p className="mb-2 text-xs text-muted">Gán quyền không kích hoạt lại tài khoản đã khóa.</p>
        <div className="max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">{availableUsers.length ? availableUsers.map((person) => <div key={person.id} className="flex items-center gap-3 p-3">{identity(person)}<button type="button" disabled={saving || !roles.length} onClick={() => { setSuccess(""); setMembers((current) => [...current, { user_id: person.id, role: roles.find((role) => role.key === "viewer")?.key || roles[0].key }]); }} className="min-h-11 shrink-0 rounded-md border border-line px-3 text-sm font-semibold text-brand-teal disabled:opacity-40">Thêm</button></div>) : <p className="p-4 text-sm text-muted">Không có người dùng phù hợp để thêm.</p>}</div>
      </>}
    </div>
  </div>;
}
