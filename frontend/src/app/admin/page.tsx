"use client";
import { useEffect, useState, useRef } from "react";
import { api, apiForm, API_URL } from "@/lib/api";
import QrUploadModal from "@/components/QrUploadModal";

interface Workshop { id: string; name: string; slug: string; event_date?: string; location?: string; }
interface FaceProfile { id: string; image_url?: string; quality_score?: number; is_active: boolean; source?: string; }
interface Guest {
  id: string; full_name: string; phone?: string; email?: string; company?: string; business_model?: string;
  role_title?: string; guest_type?: string; note?: string; party_size?: number;
  consent_face_recognition: boolean; checkin_status: string; lark_record_id?: string | null;
  created_at?: string; registered_at?: string | null; face_profiles: FaceProfile[];
}

const MAX_REFERENCE_IMAGES = 3;   // ảnh tham chiếu do admin/QR upload
const MAX_CHECKIN_SNAPSHOTS = 2;  // ảnh check-in (rolling window)

async function urlToFile(url: string, fallbackName: string): Promise<File> {
  const res = await fetch(url);
  const blob = await res.blob();
  const name = fallbackName || url.split("/").pop() || "qr.jpg";
  return new File([blob], name, { type: blob.type || "image/jpeg" });
}

function formatDateTime(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN");
}

function truncate(s: string | null | undefined, n = 28): string {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function isVip(g: Guest): boolean {
  return (g.guest_type || "").trim().toLowerCase() === "vip";
}

export default function AdminPage() {
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [wid, setWid] = useState("");
  const [guests, setGuests] = useState<Guest[]>([]);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dateSort, setDateSort] = useState<"asc" | "desc">("desc");
  const [statusFilter, setStatusFilter] = useState<"all" | "checked_in" | "not_checked_in">("all");
  const [consentLoadingId, setConsentLoadingId] = useState<string | null>(null);

  const loadWorkshops = async () => {
    const ws = await api("/workshops");
    setWorkshops(ws);
    if (ws[0] && !wid) setWid(ws[0].id);
  };
  const loadGuests = async (id: string, q = debouncedSearch, sort = dateSort) => {
    if (!id) return;
    const params = new URLSearchParams({ sort_registered_at: sort });
    if (q.trim()) params.set("search", q.trim());
    setGuests(await api(`/workshops/${id}/guests?${params.toString()}`));
  };

  useEffect(() => { loadWorkshops(); }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { loadGuests(wid); }, [wid, debouncedSearch, dateSort]);

  const currentWorkshop = workshops.find((w) => w.id === wid);

  // create guest
  const [ng, setNg] = useState<any>({ full_name: "", phone: "", business_model: "", role_title: "", guest_type: "", party_size: 1, consent_face_recognition: true });
  const createGuest = async () => {
    if (!ng.full_name || !wid) return;
    await api(`/workshops/${wid}/guests`, { method: "POST", body: JSON.stringify(ng) });
    setNg({ full_name: "", phone: "", business_model: "", role_title: "", guest_type: "", party_size: 1, consent_face_recognition: true });
    await loadGuests(wid);
  };

  const delGuest = async (id: string) => {
    await api(`/guests/${id}`, { method: "DELETE" });
    await loadGuests(wid);
  };
  const resetCheckin = async (id: string) => {
    await api("/checkin/reset", { method: "POST", body: JSON.stringify({ guest_id: id }) });
    await loadGuests(wid);
  };
  const manualCheckin = async (id: string) => {
    if (!wid) return;
    await api("/checkin/manual", {
      method: "POST",
      body: JSON.stringify({ workshop_id: wid, guest_id: id, method: "manual" }),
    });
    await loadGuests(wid);
  };

  const setVip = async (guestId: string, vip: boolean) => {
    await api(`/guests/${guestId}`, {
      method: "PATCH",
      body: JSON.stringify({ guest_type: vip ? "VIP" : null }),
    });
    setMsg(vip ? "Đã đánh dấu VIP" : "Đã bỏ đánh dấu VIP");
    await loadGuests(wid);
  };

  const toggleConsent = async (g: Guest) => {
    setConsentLoadingId(g.id);
    try {
      await api(`/guests/${g.id}`, {
        method: "PATCH",
        body: JSON.stringify({ consent_face_recognition: !g.consent_face_recognition }),
      });
      setMsg(
        g.consent_face_recognition
          ? `Đã tắt đồng ý nhận diện mặt cho ${g.full_name}`
          : `Đã bật đồng ý nhận diện mặt cho ${g.full_name}`,
      );
      await loadGuests(wid);
    } catch (e: any) {
      setMsg("Lỗi cập nhật consent: " + (e?.message || ""));
    } finally {
      setConsentLoadingId(null);
    }
  };

  const copyPhone = async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      setMsg(`Đã copy SĐT: ${phone}`);
    } catch {
      setMsg("Không thể copy SĐT");
    }
  };

  const deleteFace = async (guestId: string, faceProfileId: string) => {
    if (!window.confirm("Xóa ảnh này?")) return;
    await api(`/guests/${guestId}/face-images/${faceProfileId}`, {
      method: "DELETE",
    });
    await loadGuests(wid);
  };

  const uploadFace = async (guestId: string, file: File) => {
    const g = guests.find((x) => x.id === guestId);
    const current = (g?.face_profiles || []).filter(
      (fp) => !fp.source || fp.source === "reference"
    ).length;
    if (current >= MAX_REFERENCE_IMAGES) {
      setMsg(`Khách đã có ${current}/${MAX_REFERENCE_IMAGES} ảnh tham chiếu — không thể thêm`);
      return;
    }
    setMsg("Đang xử lý ảnh...");
    try {
      const form = new FormData();
      form.append("file", file);
      await apiForm(`/guests/${guestId}/face-images`, form);
      setMsg("Đã thêm ảnh + embedding");
      await loadGuests(wid);
    } catch (e: any) {
      setMsg("Lỗi: " + (e?.message || "upload"));
    }
  };

  // QR upload modal
  const [qrGuestId, setQrGuestId] = useState<string | null>(null);
  const qrGuest = guests.find((g) => g.id === qrGuestId) || null;

  // ===== Lark sync =====
  const [larkOpen, setLarkOpen] = useState(false);
  const [larkWs, setLarkWs] = useState<{ lark_workshop_name: string; event_date?: string; location?: string }[]>([]);
  const [larkPick, setLarkPick] = useState("");
  const [larkBusy, setLarkBusy] = useState(false);
  const [larkLoading, setLarkLoading] = useState(false);

  const openLark = async () => {
    setLarkOpen(true);
    if (larkWs.length) return;
    setLarkLoading(true);
    try {
      const ws = await api("/lark/workshops");
      setLarkWs(ws);
      if (ws[0]) setLarkPick(ws[0].lark_workshop_name);
    } catch (e: any) {
      setMsg("Lỗi tải workshop Lark: " + (e?.message || ""));
    } finally {
      setLarkLoading(false);
    }
  };

  const runLarkSync = async () => {
    if (!larkPick) return;
    setLarkBusy(true);
    setMsg("Đang đồng bộ từ Lark...");
    try {
      const res = await api("/lark/sync", {
        method: "POST",
        body: JSON.stringify({ lark_workshop_name: larkPick }),
      });
      setMsg(
        `Đồng bộ xong "${res.workshop_name}": +${res.created} mới, ${res.updated} cập nhật` +
        (res.skipped ? `, bỏ qua ${res.skipped}` : "") + ` (tổng ${res.total_from_lark} từ Lark)`,
      );
      setLarkOpen(false);
      await loadWorkshops();
      // chuyển sang workshop vừa sync
      setWid(res.workshop_id);
      await loadGuests(res.workshop_id);
    } catch (e: any) {
      setMsg("Lỗi đồng bộ Lark: " + (e?.message || ""));
    } finally {
      setLarkBusy(false);
    }
  };

  const pushUnsyncedToLark = async () => {
    if (!wid) return;
    setLarkBusy(true);
    setMsg("Đang đẩy khách chưa đồng bộ lên Lark...");
    try {
      const res = await api(`/lark/push-unsynced/${wid}`, { method: "POST" });
      setMsg(
        `Đẩy Lark xong: ${res.created}/${res.total} khách` +
        (res.failed ? `, lỗi ${res.failed}: ${res.errors?.join("; ") || ""}` : ""),
      );
      await loadGuests(wid);
    } catch (e: any) {
      setMsg("Lỗi đẩy khách lên Lark: " + (e?.message || ""));
    } finally {
      setLarkBusy(false);
    }
  };

  const totalRegistered = guests.reduce((s, g) => s + (g.party_size || 1), 0);
  const totalCheckedIn = guests
    .filter((g) => g.checkin_status === "checked_in")
    .reduce((s, g) => s + (g.party_size || 1), 0);

  const visibleGuests = guests.filter((g) => {
    if (statusFilter === "checked_in") return g.checkin_status === "checked_in";
    if (statusFilter === "not_checked_in") return g.checkin_status !== "checked_in";
    return true;
  });

  const applyQrImages = async (urls: string[]) => {
    if (!qrGuestId) return;
    const g = guests.find((x) => x.id === qrGuestId);
    const current = (g?.face_profiles || []).filter(
      (fp) => !fp.source || fp.source === "reference"
    ).length;
    const slots = Math.max(0, MAX_REFERENCE_IMAGES - current);
    const picked = urls.slice(0, slots);
    const skipped = urls.length - picked.length;
    if (!picked.length) {
      setMsg(`Khách đã đủ ${MAX_REFERENCE_IMAGES} ảnh tham chiếu — bỏ qua ${urls.length} ảnh từ mobile`);
      return;
    }
    setMsg(`Đang tải ${picked.length} ảnh từ mobile lên server...`);
    for (let i = 0; i < picked.length; i++) {
      setMsg(`Đang upload ảnh ${i + 1}/${picked.length}...`);
      try {
        const file = await urlToFile(picked[i], `qr_${Date.now()}_${i}.jpg`);
        const form = new FormData();
        form.append("file", file);
        await apiForm(`/guests/${qrGuestId}/face-images`, form);
      } catch (e: any) {
        setMsg(`Lỗi ảnh ${i + 1}: ${e?.message || "upload"}`);
        return;
      }
    }
    await loadGuests(wid);
    setMsg(
      skipped > 0
        ? `Đã thêm ${picked.length} ảnh tham chiếu (bỏ qua ${skipped} ảnh thừa, đã đủ ${MAX_REFERENCE_IMAGES})`
        : `Đã thêm ${picked.length} ảnh tham chiếu từ mobile`,
    );
  };

  const importFile = async (file: File) => {
    setMsg("Đang import...");
    const form = new FormData();
    form.append("file", file);
    const res = await apiForm(`/workshops/${wid}/import`, form);
    setMsg(`Import: ${res.imported}/${res.total_rows} dòng`);
    await loadGuests(wid);
  };

  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-brand-teal mb-4">Khách mời</h1>
        {msg && <div className="mb-3 p-2 bg-brand/10 text-brand-teal rounded-sm text-sm">{msg}</div>}

        {/* Workshops */}
        <section className="bg-surface rounded-md border border-line p-4 mb-4">
          <h2 className="font-semibold text-brand-teal mb-3">Thông tin Workshop</h2>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <select className="border border-line rounded-sm px-3 py-2" value={wid} onChange={(e) => setWid(e.target.value)}>
              {workshops.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <div className="flex items-center gap-2 ml-auto">
              <button onClick={openLark} className="bg-brand text-white px-3 py-2 rounded-sm text-sm">
                Đồng bộ từ Lark
              </button>
              <button onClick={pushUnsyncedToLark} disabled={larkBusy || !wid}
                className="border border-brand text-brand px-3 py-2 rounded-sm text-sm disabled:opacity-50">
                Đẩy khách chưa đồng bộ
              </button>
              <a href={`${API_URL}/workshops/${wid}/export`} className="bg-brand-teal text-white px-3 py-2 rounded-sm text-sm">
                Export CSV đã check-in
              </a>
              <label className="border border-line px-3 py-2 rounded-sm text-sm cursor-pointer">
                Import CSV/XLSX
                <input type="file" accept=".csv,.xlsx,.xls" className="hidden"
                  onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
              </label>
            </div>
          </div>
          {currentWorkshop && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-sm">
              <div><span className="text-muted text-xs block">Địa điểm</span>{currentWorkshop.location || "—"}</div>
              <div><span className="text-muted text-xs block">Thời gian</span>{currentWorkshop.event_date || "—"}</div>
              <div><span className="text-muted text-xs block">Số khách đã đăng ký</span>{totalRegistered}</div>
            </div>
          )}
        </section>

        {/* New guest */}
        <section className="bg-surface rounded-md border border-line p-4 mb-4">
          <h2 className="font-semibold text-brand-teal mb-2">Thêm khách</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
            {[
              ["full_name", "Họ và tên"],
              ["phone", "Số điện thoại"],
              ["business_model", "Mô hình kinh doanh"],
              ["role_title", "Chức vụ"],
              ["guest_type", "Loại khách"],
            ].map(([k, label]) => (
              <input key={k} placeholder={label} className="border border-line rounded-sm px-2 py-1"
                value={ng[k]} onChange={(e) => setNg({ ...ng, [k]: e.target.value })} />
            ))}
            <input type="number" min={1} placeholder="Số khách tham gia"
              className="border border-line rounded-sm px-2 py-1"
              value={ng.party_size}
              onChange={(e) => setNg({ ...ng, party_size: Math.max(1, parseInt(e.target.value) || 1) })} />
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={ng.consent_face_recognition}
                onChange={(e) => setNg({ ...ng, consent_face_recognition: e.target.checked })} />
              Đồng ý nhận diện mặt
            </label>
          </div>
          <button onClick={createGuest} className="mt-2 bg-brand text-white px-3 py-1.5 rounded-sm text-sm">Thêm</button>
        </section>

        {/* Guest list */}
        <section className="bg-surface rounded-md border border-line">
          <div className="sticky top-0 z-30 bg-surface/95 backdrop-blur border-b border-line
                          px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-semibold text-brand-teal">
              Khách ({guests.length} đăng ký) · Đăng ký: {totalRegistered} vé · Đã check-in: {totalCheckedIn} vé
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                className="border border-line rounded-sm px-3 py-2 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
                <option value="all">Trạng thái: Tất cả</option>
                <option value="checked_in">Đã check-in</option>
                <option value="not_checked_in">Chưa check-in</option>
              </select>
              <input
                className="border border-line rounded-sm px-3 py-2 text-sm min-w-[280px]"
                placeholder="Tìm tên, SĐT, mô hình kinh doanh..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full text-sm">
              <thead className="bg-surface-muted text-muted text-xs">
                <tr>
                  <th className="text-left px-3 py-3 min-w-[260px]">Tên khách</th>
                  <th className="text-left px-3 py-3">SĐT</th>
                  <th className="text-left px-3 py-3 min-w-[200px]">Mô hình kinh doanh</th>
                  <th className="text-center px-3 py-3 min-w-[120px]">Số vé</th>
                  <th className="text-left px-3 py-3 min-w-[280px]">Thao tác</th>
                  <th className="text-left px-3 py-3">Ảnh</th>
                  <th className="text-left px-3 py-3">
                    <button className="flex items-center gap-2" onClick={() => setDateSort(dateSort === "desc" ? "asc" : "desc")}>
                      <span>Ngày đăng ký</span>
                      <span className="rounded bg-brand/10 text-brand-teal px-2 py-0.5">
                        {dateSort === "desc" ? "Mới nhất ↓" : "Cũ nhất ↑"}
                      </span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visibleGuests.map((g) => {
                  const vip = isVip(g);
                  return (
                    <tr key={g.id} className={`${vip ? "bg-cyan-50" : ""} hover:bg-brand/5`}>
                      <td className="px-3 py-3 align-top min-w-[260px]">
                        <div className="font-semibold text-ink">{g.full_name}</div>
                        <div className="mt-1 flex gap-1 flex-wrap">
                          {vip && (
                            <span className="text-xs px-2 py-0.5 rounded bg-cyan-200 text-cyan-900 font-semibold">
                              ★ VIP
                            </span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded ${g.lark_record_id ? "bg-success/10 text-success" : "bg-surface-muted text-muted"}`}>
                            {g.lark_record_id ? "Đã đồng bộ Lark" : "Chưa đồng bộ Lark"}
                          </span>
                          {g.role_title && (
                            <span className="text-xs px-2 py-0.5 rounded bg-surface-muted text-muted">{g.role_title}</span>
                          )}
                          {g.guest_type && !vip && (
                            <span className="text-xs px-2 py-0.5 rounded bg-surface-muted text-muted">{g.guest_type}</span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <span
                            title={g.checkin_status === "checked_in" ? "Đã check-in" : "Chưa check-in"}
                            className={`text-base leading-none ${g.checkin_status === "checked_in" ? "text-success" : "text-muted"}`}>
                            {g.checkin_status === "checked_in" ? "✅" : "❌"}
                          </span>
                          <img
                            src={g.consent_face_recognition ? "/icons/consent-yes.png" : "/icons/consent-no.png"}
                            alt={g.consent_face_recognition ? "Đã đồng ý nhận diện mặt" : "Chưa đồng ý nhận diện mặt"}
                            title={g.consent_face_recognition ? "Đã đồng ý nhận diện mặt — bấm để tắt" : "Chưa đồng ý — bấm để bật"}
                            onClick={() => toggleConsent(g)}
                            className={`w-5 h-5 object-contain cursor-pointer select-none ${consentLoadingId === g.id ? "animate-pulse opacity-50" : "hover:opacity-80"}`}
                            data-testid="consent-toggle"
                            data-guest-id={g.id}
                            data-consent={g.consent_face_recognition ? "yes" : "no"}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top whitespace-nowrap">
                        {g.phone ? (
                          <button
                            onClick={() => copyPhone(g.phone!)}
                            className="text-muted underline-offset-2 hover:text-brand-teal hover:underline min-h-[32px] px-2 rounded font-mono"
                            title="Bấm để copy SĐT">
                            {g.phone}
                          </button>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top text-muted" title={g.business_model || ""}>
                        {truncate(g.business_model, 60)}
                      </td>
                      <td className="px-3 py-3 align-top text-center">{g.party_size || 1}</td>
                      <td className="px-3 py-3 align-top text-sm">
                        <div className="flex items-center gap-3 flex-wrap">
                          {g.checkin_status !== "checked_in" && (
                            <button
                              onClick={() => manualCheckin(g.id)}
                              className="text-success font-semibold underline min-h-[32px]">
                              Check-in
                            </button>
                          )}
                          <button
                            onClick={() => setVip(g.id, !vip)}
                            className="text-muted underline min-h-[32px]">
                            {vip ? "Bỏ VIP" : "Đánh dấu VIP"}
                          </button>
                          <button
                            onClick={() => resetCheckin(g.id)}
                            className="text-muted underline min-h-[32px]">
                            Reset
                          </button>
                          <button
                            onClick={() => delGuest(g.id)}
                            className="text-red-600 underline min-h-[32px]">
                            Xóa
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex flex-col gap-2 min-w-[220px]">
                          {/* Ảnh tham chiếu (admin/QR upload) */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-semibold text-muted">
                                Tham chiếu ({g.face_profiles.filter((fp) => !fp.source || fp.source === "reference").length}/{MAX_REFERENCE_IMAGES})
                              </span>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {g.face_profiles.filter((fp) => !fp.source || fp.source === "reference").map((fp) => (
                                <div key={fp.id} className="relative group">
                                  <img
                                    src={`${API_URL.replace("/api", "")}${fp.image_url}`}
                                    alt=""
                                    className="w-8 h-8 object-cover rounded border border-line"
                                    title={`q=${fp.quality_score?.toFixed(2)}`}
                                  />
                                  <button
                                    onClick={() => deleteFace(g.id, fp.id)}
                                    title="Xóa ảnh"
                                    aria-label="Xóa ảnh"
                                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full
                                               bg-red-600 text-white text-xs leading-none
                                               opacity-0 group-hover:opacity-100
                                               transition-opacity flex items-center justify-center
                                               hover:bg-red-700">
                                    ×
                                  </button>
                                </div>
                              ))}
                              {g.consent_face_recognition && g.face_profiles.filter((fp) => !fp.source || fp.source === "reference").length === 0 && (
                                <span className="text-muted text-xs">—</span>
                              )}
                            </div>
                          </div>

                          {/* Ảnh check-in (snapshot rolling 2) */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-semibold text-muted">
                                Check-in ({g.face_profiles.filter((fp) => fp.source === "checkin").length}/{MAX_CHECKIN_SNAPSHOTS})
                              </span>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {g.face_profiles.filter((fp) => fp.source === "checkin").map((fp) => (
                                <div key={fp.id} className="relative group">
                                  <img
                                    src={`${API_URL.replace("/api", "")}${fp.image_url}`}
                                    alt=""
                                    className="w-8 h-8 object-cover rounded border border-line opacity-90"
                                    title="Ảnh chụp khi check-in"
                                  />
                                  <span className="absolute -bottom-1 -left-1 text-[9px] leading-none px-1 py-0.5 rounded
                                                   bg-brand/90 text-white">auto</span>
                                  <button
                                    onClick={() => deleteFace(g.id, fp.id)}
                                    title="Xóa ảnh"
                                    aria-label="Xóa ảnh"
                                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full
                                               bg-red-600 text-white text-xs leading-none
                                               opacity-0 group-hover:opacity-100
                                               transition-opacity flex items-center justify-center
                                               hover:bg-red-700">
                                    ×
                                  </button>
                                </div>
                              ))}
                              {g.face_profiles.filter((fp) => fp.source === "checkin").length === 0 && (
                                <span className="text-muted text-xs">—</span>
                              )}
                            </div>
                          </div>

                          {/* Nút upload (chỉ cho ảnh tham chiếu) */}
                          {g.consent_face_recognition && g.face_profiles.filter((fp) => !fp.source || fp.source === "reference").length < MAX_REFERENCE_IMAGES && (
                            <div className="flex items-center gap-1">
                              <label
                                className="text-brand text-sm underline cursor-pointer
                                           min-h-[32px] px-2 py-0.5 rounded inline-flex items-center
                                           hover:bg-brand/10">
                                Upload
                                <input type="file" accept="image/*" className="hidden"
                                  onChange={(e) => e.target.files?.[0] && uploadFace(g.id, e.target.files[0])} />
                              </label>
                              <button
                                onClick={() => setQrGuestId(g.id)}
                                title="Upload bằng QR mobile"
                                className="min-h-[32px] min-w-[32px] px-2 rounded text-base hover:bg-brand/10">
                                📲
                              </button>
                            </div>
                          )}
                          {!g.consent_face_recognition && (
                            <span className="text-xs text-muted italic">Không đồng ý</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top text-muted text-xs whitespace-nowrap">
                        {formatDateTime(g.registered_at || g.created_at)}
                      </td>
                    </tr>
                  );
                })}
                {!visibleGuests.length && (
                  <tr><td colSpan={7} className="py-10 text-center text-muted">Không có khách khớp bộ lọc</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <QrUploadModal
        open={!!qrGuestId}
        onClose={() => setQrGuestId(null)}
        onApply={applyQrImages}
      />
      {larkOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !larkBusy && setLarkOpen(false)}>
          <div className="bg-surface rounded-md border border-line p-5 w-full max-w-lg"
            onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-brand-teal mb-1">Đồng bộ khách từ Lark</h3>
            <p className="text-xs text-muted mb-3">
              Chọn workshop trong Lark Base. Khách sẽ được kéo về theo trường "Workshop (final)".
              Nếu workshop chưa có trong app, hệ thống tự tạo mới.
            </p>
            {larkLoading ? (
              <div className="text-sm text-muted py-4">Đang tải danh sách workshop từ Lark...</div>
            ) : (
              <>
                <label className="block text-muted text-xs mb-1">Workshop (Lark)</label>
                <select className="border border-line rounded-sm px-3 py-2 w-full mb-2"
                  value={larkPick} onChange={(e) => setLarkPick(e.target.value)}>
                  {larkWs.map((w) => (
                    <option key={w.lark_workshop_name} value={w.lark_workshop_name}>
                      {w.lark_workshop_name}{w.event_date ? ` — ${w.event_date}` : ""}
                    </option>
                  ))}
                </select>
                {(() => {
                  const sel = larkWs.find((w) => w.lark_workshop_name === larkPick);
                  return sel?.location ? (
                    <div className="text-xs text-muted mb-3">📍 {sel.location}</div>
                  ) : null;
                })()}
              </>
            )}
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setLarkOpen(false)} disabled={larkBusy}
                className="border border-line px-3 py-1.5 rounded-sm text-sm disabled:opacity-50">
                Hủy
              </button>
              <button onClick={runLarkSync} disabled={larkBusy || larkLoading || !larkPick}
                className="bg-brand text-white px-3 py-1.5 rounded-sm text-sm disabled:opacity-50">
                {larkBusy ? "Đang đồng bộ..." : "Đồng bộ"}
              </button>
            </div>
          </div>
        </div>
      )}
      {qrGuest && (
        <div className="fixed bottom-4 right-4 z-20 bg-brand-teal text-white text-sm px-4 py-2 rounded shadow-lg max-w-xs">
          📱 Đang upload ảnh cho: <b>{qrGuest.full_name}</b> (đã có {qrGuest.face_profiles.filter((fp) => !fp.source || fp.source === "reference").length}/{MAX_REFERENCE_IMAGES})
        </div>
      )}
    </div>
  );
}
