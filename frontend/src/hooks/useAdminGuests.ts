"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, adminApi, apiForm, API_URL } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";

export interface Workshop {
  id: string;
  name: string;
  slug: string;
  event_date?: string;
  event_time?: string | null;
  location?: string;
  auto_confirm_registration?: boolean;
}

export interface Guest {
  id: string;
  workshop_id?: string;
  full_name: string;
  phone?: string;
  email?: string;
  company?: string;
  business_model?: string;
  role_title?: string;
  guest_type?: string;
  note?: string;
  party_size?: number;
  registration_status: "pending" | "confirmed";
  confirmed_at?: string | null;
  confirmed_by?: string | null;
  checkin_status: string;
  checked_in_at?: string;
  actual_party_size?: number;
  registered_at?: string | null;
  created_at?: string;
  source?: string | null;
  source_detail?: string | null;
  creator_name?: string | null;
  creator_user_id?: string | null;
  local_updated_at?: string | null;
  notes_summary?: string | null;
  zbs?: {
    registration_confirmation?: ZbsDelivery;
    checkin_confirmation?: ZbsDelivery;
  };
}

export interface GuestDetailState {
  data: Guest | null;
  loading: boolean;
  error: string | null;
}

export interface ZbsDelivery {
  id: string;
  event_type: string;
  status: string;
  phone?: string | null;
  attempt_count: number;
  msg_id?: string | null;
  last_error?: string | null;
  sent_time?: string | null;
  delivery_time?: string | null;
  updated_at?: string | null;
}

export interface NewGuestInput {
  full_name: string;
  phone: string;
  business_model: string;
  party_size: number;
  is_vip: boolean;
  source: string;
  source_detail: string;
}

export type StatusFilter = "all" | "checked_in" | "not_checked_in";

export interface DuplicatedGuestInfo {
  id: string;
  full_name: string;
  phone: string | null;
  business_model: string | null;
  party_size: number;
  guest_type: string | null;
}

const LAST_WORKSHOP_STORAGE_KEY = "workshop-checkin:last-admin-workshop";

/** Bỏ dấu tiếng Việt và viết thường, để tìm kiếm không phân biệt dấu như phía server. */
function foldText(value: string | null | undefined): string {
  return (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase();
}

/**
 * Lọc khách theo từ khóa trên máy, cùng quy tắc với tìm kiếm của server: mọi từ phải khớp đầu một từ
 * trong tên, hoặc nằm trong mô hình kinh doanh / chức danh / loại khách, hoặc nằm trong các chữ số của SĐT.
 */
function filterGuestsBySearch(guests: Guest[], search: string): Guest[] {
  const tokens = foldText(search).match(/[\p{L}\p{N}]+/gu) || [];
  if (!tokens.length) return guests;
  return guests.filter((guest) => {
    const name = foldText(guest.full_name);
    const other = [guest.business_model, guest.role_title, guest.guest_type].map(foldText).join(" ");
    const phone = (guest.phone || "").replace(/\D/g, "");
    return tokens.every((token) => {
      const digits = token.replace(/\D/g, "");
      return new RegExp(`(^|[^\\p{L}\\p{N}])${token}`, "u").test(name)
        || other.includes(token)
        || phone.includes(digits || token);
    });
  });
}

/**
 * Hook tập trung state + action cho trang Admin Khách mời.
 * Cả MobileAdmin và DesktopAdmin cùng consume để tránh duplicate logic.
 * Edit modal desktop tự quản state riêng trong component và gọi `reload()`
 * để cập nhật dữ liệu dùng chung.
 */
export function useAdminGuests() {
  const { user, canForWorkshop } = useAuth();
  const accessKey = JSON.stringify([user?.id, user?.role, user?.permissions, user?.workshop_access, user?.account_type, user?.access_workshop_id, user?.access_starts_at, user?.access_expires_at]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [wid, setWid] = useState("");
  // Toàn bộ khách của workshop, tải một lần; tìm kiếm và số liệu tổng đều tính từ danh sách này.
  const [allGuests, setAllGuests] = useState<Guest[]>([]);
  const [guestsLoading, setGuestsLoading] = useState(true);
  const [zbsStatus, setZbsStatus] = useState<Record<string, Record<string, ZbsDelivery>>>({});
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const guests = useMemo(() => filterGuestsBySearch(allGuests, debouncedSearch), [allGuests, debouncedSearch]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showDuplicateOnly, setShowDuplicateOnly] = useState(false);
  const [guestDetails, setGuestDetails] = useState<Record<string, GuestDetailState>>({});
  const [busyGuestIds, setBusyGuestIds] = useState<Set<string>>(() => new Set());
  const [importing, setImporting] = useState(false);

  const setGuestBusy = useCallback((id: string, busy: boolean) => {
    setBusyGuestIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const emptyNewGuest = (): NewGuestInput => ({
    full_name: "",
    phone: "",
    business_model: "",
    party_size: 1,
    is_vip: false,
    source: "",
    source_detail: "",
  });

  const [newGuest, setNewGuest] = useState<NewGuestInput>(emptyNewGuest);
  const [duplicateGuest, setDuplicateGuest] = useState<DuplicatedGuestInfo | null>(null);

  // Every request belongs to one workshop and permission snapshot. Old results
  // must never repopulate a screen after switching workshop or losing access.
  const signature = `${wid}:${accessKey}`;
  const generation = useRef({ signature, revision: 0 });
  if (generation.current.signature !== signature) generation.current = { signature, revision: generation.current.revision + 1 };
  const scope = `${generation.current.revision}:${signature}`;
  const live = useRef({ scope, wid, accessKey, canForWorkshop });
  live.current = { scope, wid, accessKey, canForWorkshop };
  const guestRequest = useRef(0);
  const zbsRequest = useRef(0);
  const current = useCallback((snapshot: string, id: string, permission: string = PERMISSIONS.guestsView) =>
    live.current.scope === snapshot && live.current.wid === id && live.current.canForWorkshop(permission, id), []);

  const refreshWorkshops = useCallback(async () => {
    const snapshot = live.current.accessKey;
    const ws = (await api<Workshop[]>("/workshops?permission=guests.read")).filter((workshop) => live.current.canForWorkshop(PERMISSIONS.guestsView, workshop.id));
    if (snapshot !== live.current.accessKey) return [];
    setWorkshops(ws);
    setWid((selected) => {
      if (selected && ws.some((workshop) => workshop.id === selected)) return selected;
      try {
        const stored = window.localStorage.getItem(LAST_WORKSHOP_STORAGE_KEY);
        if (stored && ws.some((workshop) => workshop.id === stored)) return stored;
        window.localStorage.removeItem(LAST_WORKSHOP_STORAGE_KEY);
      } catch { /* Storage may be disabled. */ }
      return ws[0]?.id || "";
    });
    return ws;
  }, []);

  const loadGuests = useCallback(async (id: string, adminLoading = true) => {
    const snapshot = live.current.scope;
    if (!current(snapshot, id)) return;
    const request = ++guestRequest.current;
    try {
      const data = await api<Guest[]>("/workshops/" + id + "/guests?sort_registered_at=desc", { adminLoading });
      if (current(snapshot, id) && request === guestRequest.current) setAllGuests(data.map((guest) => ({ ...guest, workshop_id: guest.workshop_id || id })));
    } catch (error) {
      if (current(snapshot, id) && request === guestRequest.current) {
        setAllGuests([]); setGuestDetails({}); setZbsStatus({});
        setMsg(error instanceof Error ? error.message : "Không tải được khách.");
      }
    } finally {
      if (current(snapshot, id) && request === guestRequest.current) setGuestsLoading(false);
    }
  }, [current]);

  /** Thay hoặc thêm một khách trong danh sách, giữ đúng vị trí của dòng đã có. */
  const upsertGuest = useCallback((guest: Guest) => {
    setAllGuests((list) => {
      const index = list.findIndex((item) => item.id === guest.id);
      if (index === -1) return [guest, ...list];
      const next = [...list];
      next[index] = { ...list[index], ...guest };
      return next;
    });
  }, []);

  /** Tải lại đúng một khách thay vì cả danh sách; khách đã bị xóa sẽ được bỏ khỏi bảng. */
  const refreshGuest = useCallback(async (guestId: string) => {
    const snapshot = live.current.scope;
    const id = live.current.wid;
    if (!current(snapshot, id)) return;
    try {
      const guest = await api<Guest>("/guests/" + guestId, { adminLoading: false });
      if (!current(snapshot, id)) return;
      if (guest.workshop_id === id) upsertGuest(guest);
      else setAllGuests((list) => list.filter((item) => item.id !== guestId));
    } catch (error) {
      if (current(snapshot, id) && error instanceof Error && /404|not found/i.test(error.message)) {
        setAllGuests((list) => list.filter((item) => item.id !== guestId));
      }
    }
  }, [current, upsertGuest]);

  const loadZbsStatus = useCallback(async (id: string) => {
    const snapshot = live.current.scope;
    if (!current(snapshot, id, PERMISSIONS.zbsView)) return;
    const request = ++zbsRequest.current;
    try {
      const data = await api<Record<string, Record<string, ZbsDelivery>>>("/workshops/" + id + "/zbs-status", { adminLoading: false });
      if (current(snapshot, id, PERMISSIONS.zbsView) && request === zbsRequest.current) setZbsStatus(data);
    } catch {
      if (current(snapshot, id) && request === zbsRequest.current) setZbsStatus({});
    }
  }, [current]);

  const loadGuestDetail = useCallback(async (guestId: string, force = false) => {
    const snapshot = scope;
    if (!current(snapshot, wid) || !allGuests.some((guest) => guest.id === guestId)) return;
    if (!force && guestDetails[guestId]?.data) return;
    setGuestDetails((data) => ({ ...data, [guestId]: { data: data[guestId]?.data || null, loading: true, error: null } }));
    try {
      const detail = await api<Guest>("/guests/" + guestId);
      if (!current(snapshot, wid) || detail.workshop_id !== wid) return;
      setGuestDetails((data) => ({ ...data, [guestId]: { data: { ...detail, zbs: zbsStatus[guestId] }, loading: false, error: null } }));
    } catch (error) {
      if (current(snapshot, wid)) setGuestDetails((data) => ({ ...data, [guestId]: { data: null, loading: false, error: error instanceof Error ? error.message : "Không tải được chi tiết khách" } }));
    }
  }, [scope, wid, current, allGuests, guestDetails, zbsStatus]);

  const refreshCachedGuestDetail = useCallback(async (guestId: string) => {
    if (guestDetails[guestId]) await loadGuestDetail(guestId, true);
  }, [guestDetails, loadGuestDetail]);

  const reload = useCallback(() => loadGuests(wid), [loadGuests, wid]);

  useEffect(() => {
    void refreshWorkshops().catch((error) => { setWorkshops([]); setWid(""); setMsg(error instanceof Error ? error.message : "Không tải được workshop."); });
  }, [refreshWorkshops, accessKey]);

  useEffect(() => {
    setAllGuests([]); setGuestsLoading(true); setGuestDetails({}); setZbsStatus({});
    setDuplicateGuest(null); setBusyGuestIds(new Set()); setNewGuest(emptyNewGuest()); setMsg("");
    // Only remember a real selection. wid is empty until workshops load, so clearing
    // here would erase the saved choice before refreshWorkshops can restore it;
    // stale or no-longer-accessible IDs are dropped there instead.
    try {
      if (wid && canForWorkshop(PERMISSIONS.guestsView, wid)) window.localStorage.setItem(LAST_WORKSHOP_STORAGE_KEY, wid);
    } catch { /* Storage may be disabled. */ }
  }, [scope]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Tìm kiếm lọc trên máy nên chỉ tải lại khi đổi workshop hoặc quyền.
  useEffect(() => {
    if (!wid) { setGuestsLoading(false); return; }
    void loadGuests(wid);
    void loadZbsStatus(wid);
  }, [scope, wid, loadGuests, loadZbsStatus]);

  useEffect(() => {
    if (!wid || !canForWorkshop(PERMISSIONS.zbsView, wid)) return;
    const timer = setInterval(() => void loadZbsStatus(wid), 5000);
    return () => clearInterval(timer);
  }, [scope, wid, loadZbsStatus]);

  const guestsWithZbs = useMemo(() => guests.filter((guest) => guest.workshop_id === wid && canForWorkshop(PERMISSIONS.guestsView, wid)).map((guest) => ({ ...guest, zbs: zbsStatus[guest.id] })), [guests, zbsStatus, wid, canForWorkshop]);
  useEffect(() => {
    setGuestDetails((data) => Object.fromEntries(Object.entries(data).map(([id, state]) => [id, state.data ? { ...state, data: { ...state.data, zbs: zbsStatus[id] } } : state])));
  }, [zbsStatus]);

  // Admin polling uses an authenticated endpoint scoped to the selected workshop.
  useEffect(() => {
    if (!wid || !canForWorkshop(PERMISSIONS.guestsView, wid)) return;
    let active = true;
    let pending = false;
    let initialized = false;
    let lastEventId: string | null = null;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const event = await adminApi<{ id?: string } | null>(`/workshops/${wid}/welcome/latest`, { adminLoading: false });
        if (!active || !current(scope, wid)) return;
        const eventId = event?.id || null;
        if (initialized && eventId && eventId !== lastEventId) {
          // Chỉ tải lại những khách vừa check-in kể từ lần kiểm tra trước; quá nhiều thì tải lại cả danh sách.
          const query = lastEventId ? `?after=${encodeURIComponent(lastEventId)}` : "";
          const changes = await adminApi<{ guest_ids: string[]; overflow: boolean }>(`/workshops/${wid}/welcome/since${query}`, { adminLoading: false });
          if (!active || !current(scope, wid)) return;
          if (changes.overflow) void loadGuests(wid, false);
          else await Promise.all(changes.guest_ids.map((guestId) => refreshGuest(guestId)));
        }
        initialized = true;
        lastEventId = eventId;
      } catch { /* Guest API and auth refresh surface permission changes. */ }
      finally { pending = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [scope, wid, loadGuests, refreshGuest, current]);

  const allowed = useCallback((permission: string, guest?: Guest | string) => {
    const guestId = typeof guest === "string" ? guest : guest?.id;
    const resource = typeof guest === "string" ? allGuests.find((item) => item.id === guest) : guest;
    const valid = current(scope, wid, permission) && (!guestId || (resource?.workshop_id === wid && allGuests.some((item) => item.id === guestId)));
    if (!valid) setMsg("Bạn không có quyền thực hiện thao tác tại workshop này.");
    return valid;
  }, [current, scope, wid, allGuests]);

  const setActionMsg = useCallback((message: string) => { if (current(scope, wid)) setMsg(message); }, [current, scope, wid]);

  // ----- guest actions -----
  const createGuest = useCallback(async (): Promise<boolean> => {
    const createPermission = current(scope, wid, PERMISSIONS.guestsCreate) ? PERMISSIONS.guestsCreate : PERMISSIONS.guestsCreateOnly;
    if (!allowed(createPermission)) return false;
    const full_name = newGuest.full_name.trim();
    const phone = newGuest.phone.trim();
    const business_model = newGuest.business_model.trim();
    const source = newGuest.source.trim();
    const source_detail = newGuest.source_detail.trim();
    const party_size = Math.max(1, Math.floor(Number(newGuest.party_size)) || 1);
    // Mô hình kinh doanh và nguồn không bắt buộc khi thêm khách; chỉ cần ghi rõ nếu chọn nguồn "Khác".
    if (!full_name || !phone || (source === "Khác" && !source_detail)) {
      setActionMsg(source === "Khác" && !source_detail ? "Vui lòng ghi rõ nguồn." : "Vui lòng nhập Họ tên và Số điện thoại.");
      return false;
    }
    try {
      const res = await fetch(`${API_URL}/workshops/${wid}/guests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          full_name,
          phone,
          business_model: business_model || null,
          party_size,
          guest_type: newGuest.is_vip ? "vip" : null,
          source: source || null,
          source_detail: source === "Khác" ? source_detail : undefined,
        }),
      });
      if (!current(scope, wid)) return false;
      if (res.status === 409) {
        const data = await res.json();
        if (!current(scope, wid)) return false;
        setDuplicateGuest(data.existing_guest as DuplicatedGuestInfo);
        setActionMsg(data.detail + ", bạn có muốn sửa thông tin không?");
        return false;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let message = text;
        try {
          const payload = JSON.parse(text);
          message = typeof payload.detail === "string" ? payload.detail : text;
        } catch { /* keep raw text */ }
        setActionMsg("Lỗi thêm khách: " + (message || "không rõ"));
        return false;
      }
      const created = await res.json() as Guest;
      if (!current(scope, wid)) return false;
      setNewGuest(emptyNewGuest());
      setActionMsg("Đã thêm khách.");
      upsertGuest({ ...created, workshop_id: created.workshop_id || wid });
      return true;
    } catch (e: any) {
      setActionMsg("Lỗi thêm khách: " + (e?.message || "không rõ"));
      return false;
    }
  }, [setActionMsg, allowed, current, scope, newGuest, wid, upsertGuest]);

  const delGuest = useCallback(
    async (id: string): Promise<boolean> => {
      if (!allowed(PERMISSIONS.guestsDelete, id) || busyGuestIds.has(id)) return false;
      if (!confirm("Xóa khách này?")) return false;
      setGuestBusy(id, true);
      try {
        await api("/guests/" + id, { method: "DELETE" });
        setGuestDetails((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        setAllGuests((list) => list.filter((item) => item.id !== id));
        return true;
      } catch (e: any) {
        setActionMsg("Lỗi xóa khách: " + (e?.message || "không rõ"));
        return false;
      } finally {
        setGuestBusy(id, false);
      }
    },
    [setActionMsg, allowed, busyGuestIds, setGuestBusy],
  );

  const doCheckin = useCallback(
    async (guest: Guest, actualPartySize?: number) => {
      if (!allowed(PERMISSIONS.guestsCheckin, guest)) return;
      let actual = actualPartySize;
      if (actual === undefined) {
        const input = prompt(
          `Số khách check-in cho "${guest.full_name}" (số nguyên ≥ 1):`,
          String(guest.party_size || 1),
        );
        if (input === null) return;
        actual = parseInt(input, 10);
      }
      if (typeof actual !== "number" || !Number.isInteger(actual) || actual < 1) {
        setActionMsg("Số khách check-in phải là số nguyên lớn hơn hoặc bằng 1");
        return;
      }
      try {
        await api("/guests/" + guest.id + "/checkin", {
          method: "POST",
          body: JSON.stringify({ actual_party_size: actual }),
        });
        setActionMsg("Đã check-in " + guest.full_name + " (" + actual + " khách)");
        await refreshGuest(guest.id);
        await refreshCachedGuestDetail(guest.id);
      } catch (e: any) {
        setActionMsg("Lỗi check-in: " + (e?.message || "không rõ"));
      }
    },
    [setActionMsg, allowed, refreshGuest, refreshCachedGuestDetail],
  );

  const confirmRegistration = useCallback(async (guest: Guest) => {
    if (!allowed(PERMISSIONS.guestsEdit, guest)) return;
    try {
      await api("/guests/" + guest.id + "/confirm", { method: "POST" });
      setActionMsg("Đã xác nhận đăng ký của " + guest.full_name);
      await refreshGuest(guest.id);
      await refreshCachedGuestDetail(guest.id);
    } catch (e: any) {
      setActionMsg("Lỗi xác nhận đăng ký: " + (e?.message || "không rõ"));
    }
  }, [setActionMsg, allowed, refreshGuest, refreshCachedGuestDetail]);

  const doUncheckin = useCallback(
    async (guest: Guest) => {
      if (!allowed(PERMISSIONS.guestsCheckin, guest)) return;
      if (!confirm(`Hoàn tác check-in của "${guest.full_name}"?`)) return;
      try {
        await api("/guests/" + guest.id + "/uncheckin", { method: "POST" });
        setActionMsg("Đã hủy check-in " + guest.full_name);
        await refreshGuest(guest.id);
        await refreshCachedGuestDetail(guest.id);
      } catch (e: any) {
        setActionMsg("Lỗi hủy check-in: " + (e?.message || "không rõ"));
      }
    },
    [setActionMsg, allowed, refreshGuest, refreshCachedGuestDetail],
  );

  const toggleVip = useCallback(
    async (guest: Guest) => {
      if (!allowed(PERMISSIONS.guestsEdit, guest) || busyGuestIds.has(guest.id)) return;
      const vip = (guest.guest_type || "").trim().toLowerCase() !== "vip";
      setGuestBusy(guest.id, true);
      try {
        await api("/guests/" + guest.id, {
          method: "PATCH",
          body: JSON.stringify({ guest_type: vip ? "VIP" : null }),
        });
        await refreshGuest(guest.id);
        await refreshCachedGuestDetail(guest.id);
      } catch (e: any) {
        setActionMsg("Lỗi cập nhật VIP: " + (e?.message || "không rõ"));
      } finally {
        setGuestBusy(guest.id, false);
      }
    },
    [setActionMsg, allowed, busyGuestIds, refreshGuest, refreshCachedGuestDetail, setGuestBusy],
  );

  const copyPhone = useCallback(async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      setActionMsg("Đã copy SĐT: " + phone);
    } catch {
      setActionMsg("Không thể copy SĐT");
    }
  }, [setActionMsg]);

  const retryZbs = useCallback(async (delivery: ZbsDelivery) => {
    if (!allowed(PERMISSIONS.zbsManage) || !Object.values(zbsStatus).some((items) => Object.values(items).some((item) => item.id === delivery.id))) return;
    try {
      await api("/zbs/deliveries/" + delivery.id + "/retry", { method: "POST" });
      setActionMsg("Đã xếp lại tin ZBS để gửi.");
      await loadZbsStatus(wid);
    } catch (e: any) {
      setActionMsg("Lỗi gửi lại ZBS: " + (e?.message || "không rõ"));
    }
  }, [setActionMsg, allowed, zbsStatus, wid, loadZbsStatus]);

  const sendZbsManually = useCallback(async (guest: Guest, taskKey: "registration_confirmation" | "checkin_confirmation") => {
    if (!allowed(PERMISSIONS.zbsManage, guest)) return;
    const taskLabel = taskKey === "checkin_confirmation" ? "xác nhận Check-in" : "xác nhận đăng ký";
    if (!confirm(`Gửi ZBS ${taskLabel} thủ công cho ${guest.full_name}? Thao tác này có thể phát sinh chi phí.`)) return;
    try {
      await api(`/zbs/guests/${guest.id}/send/${taskKey}`, { method: "POST" });
      setActionMsg("Đã xếp tin ZBS thủ công để gửi.");
      await loadZbsStatus(wid);
      await refreshCachedGuestDetail(guest.id);
    } catch (e: any) {
      setActionMsg("Lỗi gửi ZBS thủ công: " + (e?.message || "không rõ"));
    }
  }, [setActionMsg, allowed, loadZbsStatus, refreshCachedGuestDetail, wid]);

  const importFile = useCallback(
    async (file: File) => {
      if (!allowed(PERMISSIONS.guestsImport) || importing) return;
      setImporting(true);
      setActionMsg("Đang nhập dữ liệu...");
      try {
        const fd = new FormData();
        fd.append("file", file);
        const data = await apiForm<any>("/workshops/" + wid + "/import", fd);
        setActionMsg("Nhập: " + data.imported + "/" + data.total_rows + " dòng");
        await loadGuests(wid);
      } catch (e: any) {
        setActionMsg("Lỗi nhập dữ liệu: " + (e?.message || "không rõ"));
      } finally {
        setImporting(false);
      }
    },
    [setActionMsg, allowed, importing, wid, loadGuests],
  );

  // ----- derived -----
  const totalRegistered = useMemo(
    () => allGuests.filter((guest) => guest.workshop_id === wid && canForWorkshop(PERMISSIONS.guestsView, wid)).reduce((s, g) => s + (g.party_size || 1), 0),
    [allGuests, wid, canForWorkshop],
  );
  const totalCheckedIn = useMemo(
    () =>
      allGuests
        .filter((g) => g.workshop_id === wid && canForWorkshop(PERMISSIONS.guestsView, wid) && g.checkin_status === "checked_in")
        .reduce((s, g) => s + (g.party_size || 1), 0),
    [allGuests, wid, canForWorkshop],
  );
  const totalRecords = allGuests.filter((guest) => guest.workshop_id === wid && canForWorkshop(PERMISSIONS.guestsView, wid)).length;
  const checkedInRecords = useMemo(
    () => allGuests.filter((g) => g.workshop_id === wid && canForWorkshop(PERMISSIONS.guestsView, wid) && g.checkin_status === "checked_in").length,
    [allGuests, wid, canForWorkshop],
  );

  const normalizePhone = (p: string | null | undefined) => (p || "").replace(/\D/g, "");
  const duplicatePhones = useMemo(() => {
    const count = new Map<string, number>();
    guestsWithZbs.forEach((g) => {
      const p = normalizePhone(g.phone);
      if (p) count.set(p, (count.get(p) || 0) + 1);
    });
    return new Set([...count.entries()].filter(([, c]) => c > 1).map(([p]) => p));
  }, [guestsWithZbs]);

  const visibleGuests = useMemo(
    () => {
      let result = guestsWithZbs.filter((g) => {
        if (statusFilter === "checked_in") return g.checkin_status === "checked_in";
        if (statusFilter === "not_checked_in") return g.checkin_status !== "checked_in";
        return true;
      });
      if (showDuplicateOnly) {
        result = result.filter((g) => duplicatePhones.has(normalizePhone(g.phone)));
      }
      return result;
    },
    [guestsWithZbs, statusFilter, showDuplicateOnly, duplicatePhones],
  );

  const clearDuplicateGuest = useCallback(() => setDuplicateGuest(null), []);

  const currentWorkshop = useMemo(
    () => workshops.find((w) => w.id === wid),
    [workshops, wid],
  );

  return {
    // state
    workshops,
    wid,
    setWid,
    guests: guestsWithZbs,
    msg,
    setMsg,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    showDuplicateOnly,
    setShowDuplicateOnly,
    newGuest,
    setNewGuest,
    busyGuestIds,
    importing,
    // derived
    visibleGuests,
    totalRegistered,
    totalCheckedIn,
    totalRecords,
    checkedInRecords,
    currentWorkshop,
    duplicatePhones,
    duplicateGuest,
    // actions
    createGuest,
    delGuest,
    doCheckin,
    confirmRegistration,
    doUncheckin,
    toggleVip,
    copyPhone,
    retryZbs,
    sendZbsManually,
    guestDetails,
    loadGuestDetail,
    importFile,
    reload,
    refreshGuest,
    guestsLoading,
    refreshWorkshops,
    clearDuplicateGuest,

  };
}
