"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiForm } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";

export interface Workshop {
  id: string;
  name: string;
  slug: string;
  event_date?: string;
  event_time?: string | null;
  location?: string;
  lark_workshop_name?: string;
  last_synced_at?: string | null;
}

export interface Guest {
  id: string;
  full_name: string;
  phone?: string;
  email?: string;
  company?: string;
  business_model?: string;
  role_title?: string;
  guest_type?: string;
  note?: string;
  party_size?: number;
  checkin_status: string;
  checked_in_at?: string;
  actual_party_size?: number;
  lark_record_id?: string | null;
  registered_at?: string | null;
  created_at?: string;
  sync_status?: string;
  sync_error?: string | null;
  source?: string | null;
  source_detail?: string | null;
  creator_name?: string | null;
  creator_user_id?: string | null;
  zbs?: {
    registration_confirmation?: ZbsDelivery;
  };
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

export interface LarkWorkshop {
  lark_workshop_name: string;
  event_date?: string;
  location?: string;
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

/**
 * Hook tập trung state + action cho trang Admin Khách mời.
 * Cả MobileAdmin và DesktopAdmin cùng consume để tránh duplicate logic.
 * Desktop-only (Lark sync, edit modal) tự quản state riêng trong component,
 * chỉ gọi `reload()` / `refreshWorkshops()` từ hook để đồng bộ dữ liệu.
 */
export function useAdminGuests() {
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [wid, setWid] = useState("");
  const [guests, setGuests] = useState<Guest[]>([]);
  const [allGuests, setAllGuests] = useState<Guest[]>([]);
  const [zbsStatus, setZbsStatus] = useState<Record<string, Record<string, ZbsDelivery>>>({});
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

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

  // ----- data loading -----
  const refreshWorkshops = useCallback(async () => {
    const ws = await api<Workshop[]>("/workshops");
    setWorkshops(ws);
    setWid((curr) => curr || ws[0]?.id || "");
    return ws;
  }, []);

  const loadGuests = useCallback(async (id: string, q?: string, sort?: string) => {
    if (!id) return;
    const params = new URLSearchParams();
    params.set("sort_registered_at", sort || "desc");
    if (q) params.set("search", q);
    setGuests(await api<Guest[]>("/workshops/" + id + "/guests?" + params.toString()));
  }, []);

  const loadAllGuests = useCallback(async (id: string) => {
    if (!id) {
      setAllGuests([]);
      return;
    }
    setAllGuests(await api<Guest[]>("/workshops/" + id + "/guests?sort_registered_at=desc"));
  }, []);

  const loadZbsStatus = useCallback(async (id: string) => {
    if (!id) return;
    try {
      setZbsStatus(await api<Record<string, Record<string, ZbsDelivery>>>("/workshops/" + id + "/zbs-status"));
    } catch {
      setZbsStatus({});
    }
  }, []);

  /** Reload danh sách khách hiện hành theo wid + search đang áp dụng. */
  const reload = useCallback(
    () => loadGuests(wid, debouncedSearch),
    [loadGuests, wid, debouncedSearch],
  );

  useEffect(() => {
    refreshWorkshops();
  }, [refreshWorkshops]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    loadGuests(wid, debouncedSearch);
    loadZbsStatus(wid);
  }, [wid, debouncedSearch, loadGuests, loadZbsStatus]);

  useEffect(() => {
    if (!wid) return;
    const interval = setInterval(() => loadZbsStatus(wid), 5000);
    return () => clearInterval(interval);
  }, [wid, loadZbsStatus]);

  // Stats độc lập với search/filter.
  useEffect(() => {
    loadAllGuests(wid);
  }, [wid, loadAllGuests]);
  useEffect(() => {
    if (wid) loadAllGuests(wid);
  }, [guests, wid, loadAllGuests]);

  const guestsWithZbs = useMemo(
    () => guests.map((guest) => ({ ...guest, zbs: zbsStatus[guest.id] })),
    [guests, zbsStatus],
  );

  // ----- WS + fallback poll -----
  const { connected } = useWebSocket((data: any) => {
    if (data?.type === "welcome" && data.workshop_id === wid) {
      loadGuests(wid, debouncedSearch);
    }
  });

  useEffect(() => {
    if (connected || !wid) return;
    let lastEventId: string | null = null;
    let isInitial = true;
    const poll = async () => {
      try {
        const res = await api<any>("/checkin/welcome/latest");
        if (res && res.id) {
          if (isInitial) {
            isInitial = false;
            lastEventId = res.id;
            return;
          }
          if (res.id !== lastEventId) {
            lastEventId = res.id;
            if (res.workshop_id === wid) loadGuests(wid, debouncedSearch);
          }
        }
      } catch {
        /* ignore */
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [connected, wid, debouncedSearch, loadGuests]);

  // ----- guest actions -----
  const createGuest = useCallback(async (): Promise<boolean> => {
    if (!wid) return false;
    const full_name = newGuest.full_name.trim();
    const phone = newGuest.phone.trim();
    const business_model = newGuest.business_model.trim();
    const source = newGuest.source.trim();
    const source_detail = newGuest.source_detail.trim();
    const party_size = Math.max(1, Math.floor(Number(newGuest.party_size)) || 1);
    if (!full_name || !phone || !business_model || !source || (source === "Khác" && !source_detail)) {
      setMsg("Vui lòng nhập đủ thông tin khách và chọn nguồn.");
      return false;
    }
    try {
      await api("/workshops/" + wid + "/guests", {
        method: "POST",
        body: JSON.stringify({
          full_name,
          phone,
          business_model,
          party_size,
          guest_type: newGuest.is_vip ? "vip" : null,
          source,
          source_detail: source === "Khác" ? source_detail : undefined,
        }),
      });
      setNewGuest(emptyNewGuest());
      setMsg("Đã thêm khách.");
      await loadGuests(wid, debouncedSearch);
      return true;
    } catch (e: any) {
      setMsg("Lỗi thêm khách: " + (e?.message || "không rõ"));
      return false;
    }
  }, [newGuest, wid, debouncedSearch, loadGuests]);

  const delGuest = useCallback(
    async (id: string) => {
      if (!confirm("Xóa khách này?")) return;
      await api("/guests/" + id, { method: "DELETE" });
      await loadGuests(wid, debouncedSearch);
    },
    [wid, debouncedSearch, loadGuests],
  );

  const doCheckin = useCallback(
    async (guest: Guest) => {
      const input = prompt(
        `Số khách check-in cho "${guest.full_name}" (số nguyên ≥ 1):`,
        String(guest.party_size || 1),
      );
      if (input === null) return;
      const actual = parseInt(input, 10);
      if (!Number.isInteger(actual) || actual < 1) {
        setMsg("Số khách check-in phải là số nguyên lớn hơn hoặc bằng 1");
        return;
      }
      try {
        const res = await api<any>("/guests/" + guest.id + "/checkin", {
          method: "POST",
          body: JSON.stringify({ actual_party_size: actual }),
        });
        const errStr = res.lark_error ? " (Lỗi Lark: " + res.lark_error + ")" : "";
        setMsg("Đã check-in " + guest.full_name + " (" + actual + " khách)" + errStr);
        await loadGuests(wid, debouncedSearch);
      } catch (e: any) {
        setMsg("Lỗi check-in: " + (e?.message || "không rõ"));
      }
    },
    [wid, debouncedSearch, loadGuests],
  );

  const doUncheckin = useCallback(
    async (guest: Guest) => {
      try {
        const res = await api<any>("/guests/" + guest.id + "/uncheckin", { method: "POST" });
        const errStr = res.lark_error ? " (Lỗi Lark: " + res.lark_error + ")" : "";
        setMsg("Đã hủy check-in " + guest.full_name + errStr);
        await loadGuests(wid, debouncedSearch);
      } catch (e: any) {
        setMsg("Lỗi hủy check-in: " + (e?.message || "không rõ"));
      }
    },
    [wid, debouncedSearch, loadGuests],
  );

  const toggleVip = useCallback(
    async (guest: Guest) => {
      const vip = (guest.guest_type || "").trim().toLowerCase() !== "vip";
      await api("/guests/" + guest.id, {
        method: "PATCH",
        body: JSON.stringify({ guest_type: vip ? "VIP" : null }),
      });
      await loadGuests(wid, debouncedSearch);
    },
    [wid, debouncedSearch, loadGuests],
  );

  const copyPhone = useCallback(async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      setMsg("Đã copy SĐT: " + phone);
    } catch {
      setMsg("Không thể copy SĐT");
    }
  }, []);

  const resolveConflict = useCallback(
    async (guest: Guest, direction: "local" | "lark") => {
      try {
        const res = await api<any>("/lark/sync/resolve/" + guest.id, {
          method: "POST",
          body: JSON.stringify({ direction }),
        });
        const label = direction === "local" ? "Local" : "Lark";
        const okStr = res.resolved ? "Đã xử lý: ưu tiên " + label : "Lỗi xử lý: " + (res.error || "");
        setMsg(okStr);
        await loadGuests(wid, debouncedSearch);
      } catch (e: any) {
        setMsg("Lỗi xử lý xung đột: " + (e?.message || "không rõ"));
      }
    },
    [wid, debouncedSearch, loadGuests],
  );

  const retryZbs = useCallback(async (delivery: ZbsDelivery) => {
    try {
      await api("/zbs/deliveries/" + delivery.id + "/retry", { method: "POST" });
      setMsg("Đã xếp lại tin ZBS để gửi.");
      await loadZbsStatus(wid);
    } catch (e: any) {
      setMsg("Lỗi gửi lại ZBS: " + (e?.message || "không rõ"));
    }
  }, [wid, loadZbsStatus]);

  const importFile = useCallback(
    async (file: File) => {
      setMsg("Đang nhập dữ liệu...");
      const fd = new FormData();
      fd.append("file", file);
      const data = await apiForm<any>("/workshops/" + wid + "/import", fd);
      setMsg("Nhập: " + data.imported + "/" + data.total_rows + " dòng");
      await loadGuests(wid, debouncedSearch);
    },
    [wid, debouncedSearch, loadGuests],
  );

  // ----- derived -----
  const totalRegistered = useMemo(
    () => allGuests.reduce((s, g) => s + (g.party_size || 1), 0),
    [allGuests],
  );
  const totalCheckedIn = useMemo(
    () =>
      allGuests
        .filter((g) => g.checkin_status === "checked_in")
        .reduce((s, g) => s + (g.party_size || 1), 0),
    [allGuests],
  );
  const totalRecords = allGuests.length;
  const checkedInRecords = useMemo(
    () => allGuests.filter((g) => g.checkin_status === "checked_in").length,
    [allGuests],
  );

  const visibleGuests = useMemo(
    () =>
      guestsWithZbs.filter((g) => {
        if (statusFilter === "checked_in") return g.checkin_status === "checked_in";
        if (statusFilter === "not_checked_in") return g.checkin_status !== "checked_in";
        return true;
      }),
    [guestsWithZbs, statusFilter],
  );

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
    newGuest,
    setNewGuest,
    // derived
    visibleGuests,
    totalRegistered,
    totalCheckedIn,
    totalRecords,
    checkedInRecords,
    currentWorkshop,
    // actions
    createGuest,
    delGuest,
    doCheckin,
    doUncheckin,
    toggleVip,
    copyPhone,
    resolveConflict,
    retryZbs,
    importFile,
    reload,
    refreshWorkshops,
    connected,
  };
}
