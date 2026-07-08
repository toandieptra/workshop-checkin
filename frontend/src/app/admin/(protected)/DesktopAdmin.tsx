"use client";
import { useState } from "react";
import QrDisplay from "@/components/QrDisplay";
import { api, API_URL } from "@/lib/api";
import { useAdminGuests, type Guest, type LarkWorkshop } from "@/hooks/useAdminGuests";

function formatDateTime(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN");
}

function truncate(s: string | null | undefined, n = 40): string {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function isVip(g: Guest): boolean {
  return (g.guest_type || "").trim().toLowerCase() === "vip";
}

function SyncBadge({ status, error }: { status?: string; error?: string | null }) {
  if (status === "synced") {
    return <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">Đã đồng bộ</span>;
  }
  if (status === "conflict") {
    return (
      <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 font-medium" title={error || ""}>
        Xung đột
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700" title={error || ""}>
        Lỗi đồng bộ
      </span>
    );
  }
  if (status === "pending_push") {
    return <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600">Chờ đồng bộ</span>;
  }
  return <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">—</span>;
}

function WelcomeLinkCard({ slug }: { slug: string }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}/welcome?w=${slug}`;
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard không khả dụng */
    }
  };

  return (
    <div className="bg-surface rounded-md border-2 border-red-500 p-5 flex flex-col items-center">
      <div className="font-semibold text-brand-teal mb-1 flex items-center gap-1.5">
        <span aria-hidden>🔗</span> LINK TRANG WELCOME
      </div>
      <div className="text-xs text-muted mb-3 text-center">
        Trang TV đón khách của riêng workshop này
      </div>
      <div className="w-full max-w-[280px] flex flex-col items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted w-full">
          <span aria-hidden>🌐</span>
          <span className="truncate font-mono" title={url}>{url}</span>
        </div>
        <button
          onClick={copyLink}
          className="border border-line text-brand-teal px-3 py-1.5 rounded-sm text-sm hover:bg-brand/5 w-full"
        >
          {copied ? "Đã sao chép ✓" : "Sao chép link"}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="border border-brand text-brand px-3 py-1.5 rounded-sm text-sm hover:bg-brand/5 w-full text-center"
        >
          Mở trang Welcome →
        </a>
      </div>
    </div>
  );
}

/**
 * Desktop view cho trang Admin Khách mời — UI gốc, không đổi hành vi.
 * State/actions lấy từ useAdminGuests (share với MobileAdmin).
 * Lark sync + edit modal là desktop-only: giữ state cục bộ tại đây,
 * gọi reload()/refreshWorkshops()/setWid() từ hook để đồng bộ.
 */
export default function DesktopAdmin() {
  const {
    workshops,
    wid,
    setWid,
    visibleGuests,
    newGuest,
    setNewGuest,
    createGuest,
    delGuest,
    doCheckin,
    doUncheckin,
    toggleVip,
    copyPhone,
    resolveConflict,
    importFile,
    reload,
    refreshWorkshops,
    totalRegistered,
    totalCheckedIn,
    totalRecords,
    checkedInRecords,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    currentWorkshop,
    msg,
    setMsg,
  } = useAdminGuests();

  // ----- Lark sync (desktop-only) -----
  const [larkOpen, setLarkOpen] = useState(false);
  const [larkWs, setLarkWs] = useState<LarkWorkshop[]>([]);
  const [larkPick, setLarkPick] = useState("");
  const [larkBusy, setLarkBusy] = useState(false);
  const [larkLoading, setLarkLoading] = useState(false);

  const openLark = async () => {
    setLarkOpen(true);
    if (larkWs.length) return;
    setLarkLoading(true);
    try {
      const ws = await api<LarkWorkshop[]>("/lark/workshops");
      setLarkWs(ws);
      if (ws[0]) setLarkPick(ws[0].lark_workshop_name);
    } catch (e: any) {
      setMsg("Lỗi tải workshop Lark: " + (e?.message || "không rõ"));
    } finally {
      setLarkLoading(false);
    }
  };

  const runLarkPull = async () => {
    if (!larkPick) return;
    setLarkBusy(true);
    setMsg("Đang kéo dữ liệu từ Lark...");
    try {
      const params = new URLSearchParams({ lark_workshop_name: larkPick });
      if (wid) params.set("target_workshop_id", wid);
      const res = await api<any>("/lark/sync/pull?" + params.toString(), { method: "POST" });
      let txt = "Kéo xong: +" + res.pulled + " cập nhật";
      if (res.conflicts) txt += ", xung đột " + res.conflicts;
      if (res.errors) txt += ", lỗi " + res.errors;
      setMsg(txt);
      setLarkOpen(false);
      await refreshWorkshops();
      if (res.workshop_id) setWid(res.workshop_id);
      await reload();
    } catch (e: any) {
      setMsg("Lỗi kéo từ Lark: " + (e?.message || "không rõ"));
    } finally {
      setLarkBusy(false);
    }
  };

  const runLarkPush = async () => {
    if (!wid) return;
    setLarkBusy(true);
    setMsg("Đang đẩy lên Lark...");
    try {
      const res = await api<any>("/lark/sync/push/" + wid, { method: "POST" });
      let txt = "Đẩy xong: " + res.pushed + "/" + res.total + " đã đẩy";
      if (res.errors) txt += ", lỗi " + res.errors;
      setMsg(txt);
      await reload();
    } catch (e: any) {
      setMsg("Lỗi đẩy lên Lark: " + (e?.message || "không rõ"));
    } finally {
      setLarkBusy(false);
    }
  };

  const runLarkFull = async () => {
    if (!wid) return;
    setLarkBusy(true);
    setMsg("Đang đồng bộ toàn bộ...");
    const ws = workshops.find((w) => w.id === wid);
    const larkName = ws?.lark_workshop_name || ws?.name || "";
    try {
      const params = new URLSearchParams({ lark_workshop_name: larkName, target_workshop_id: wid });
      const res = await api<any>("/lark/sync/full?" + params.toString(), { method: "POST" });
      let txt = "Đồng bộ toàn bộ: kéo +" + res.pulled;
      if (res.conflicts) txt += ", xung đột " + res.conflicts;
      txt += " → đẩy " + (res.push?.pushed || 0) + "/" + (res.push?.total || 0);
      if (res.push?.errors) txt += ", lỗi " + res.push.errors;
      setMsg(txt);
      await reload();
    } catch (e: any) {
      setMsg("Lỗi đồng bộ toàn bộ: " + (e?.message || "không rõ"));
    } finally {
      setLarkBusy(false);
    }
  };

  const runLarkWorkshopsSync = async () => {
    setLarkBusy(true);
    setMsg("Đang đồng bộ danh sách sự kiện từ Lark...");
    try {
      const res = await api<any>("/lark/sync/workshops", { method: "POST" });
      let txt = `Đồng bộ sự kiện: +${res.created} mới, ${res.updated} cập nhật`;
      if (res.errors) txt += `, lỗi ${res.errors}`;
      setMsg(txt);
      await refreshWorkshops();
    } catch (e: any) {
      setMsg("Lỗi đồng bộ sự kiện: " + (e?.message || "không rõ"));
    } finally {
      setLarkBusy(false);
    }
  };

  // ----- Edit modal (desktop-only) -----
  const [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState<any>({});
  const [editBusy, setEditBusy] = useState(false);

  const openEdit = (g: Guest) => {
    setEditId(g.id);
    setEf({
      full_name: g.full_name || "",
      phone: g.phone || "",
      business_model: g.business_model || "",
      role_title: g.role_title || "",
      guest_type: g.guest_type || "",
      party_size: g.party_size || 1,
      note: g.note || "",
    });
  };

  const saveEdit = async () => {
    if (!editId || !ef.full_name || editBusy) return;
    setEditBusy(true);
    try {
      const res = await api<any>("/guests/" + editId + "?sync_lark=true", {
        method: "PATCH",
        body: JSON.stringify({ ...ef, party_size: Math.max(1, parseInt(ef.party_size) || 1) }),
      });
      const errStr = res.lark_error ? " (Lỗi Lark: " + res.lark_error + ")" : "";
      setMsg("Đã lưu & đồng bộ Lark" + errStr);
      setEditId(null);
      await reload();
    } catch (e: any) {
      setMsg("Lỗi lưu: " + (e?.message || "không rõ"));
    } finally {
      setEditBusy(false);
    }
  };

  // ----- Render -----
  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-brand-teal mb-4">Khách mời</h1>
        {msg && (
          <div className="mb-3 p-2 bg-brand/10 text-brand-teal rounded-sm text-sm flex items-center justify-between">
            <span>{msg}</span>
            <button onClick={() => setMsg("")} className="text-muted text-lg leading-none">×</button>
          </div>
        )}

        {/* Workshop info */}
        <section className="mb-4">
          <div className="bg-surface rounded-md border border-line p-4 mb-4 flex items-center gap-3 flex-wrap justify-between">
            <select
              className="border border-line rounded-sm px-3 py-2 min-w-[240px]"
              value={wid}
              onChange={(e) => setWid(e.target.value)}
            >
              {workshops.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={runLarkWorkshopsSync}
                disabled={larkBusy}
                className="bg-brand text-white px-3 py-2 rounded-sm text-sm disabled:opacity-50"
                title="Kéo danh sách workshop mới + cập nhật thông tin từ bảng Lark Workshop config"
              >
                Đồng bộ sự kiện
              </button>
              <button
                onClick={runLarkFull}
                disabled={larkBusy || !wid}
                className="bg-brand text-white px-3 py-2 rounded-sm text-sm disabled:opacity-50"
              >
                Đồng bộ toàn bộ
              </button>
              <button
                onClick={openLark}
                className="border border-brand text-brand px-3 py-2 rounded-sm text-sm"
              >
                Đồng bộ từ Lark
              </button>
              <button
                onClick={runLarkPush}
                disabled={larkBusy || !wid}
                className="border border-brand text-brand px-3 py-2 rounded-sm text-sm disabled:opacity-50"
              >
                Đẩy lên Lark
              </button>
              <a
                href={API_URL + "/export/guests?workshop_id=" + wid}
                className="border border-line px-3 py-2 rounded-sm text-sm"
              >
                Xuất Excel
              </a>
              <label className="border border-line px-3 py-2 rounded-sm text-sm cursor-pointer">
                Nhập CSV/XLSX
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
                />
              </label>
            </div>
          </div>

          {currentWorkshop && (
            <div className="grid lg:grid-cols-10 gap-4 mb-4 items-stretch">
              <div className="lg:col-span-7 h-full bg-surface rounded-md border border-line p-5 flex flex-col">
                <h2 className="font-semibold text-brand-teal mb-4 flex items-center gap-1.5">
                  <span aria-hidden>📘</span> Thông tin Workshop
                  {currentWorkshop.last_synced_at && (
                    <span className="font-normal text-xs text-muted ml-1">
                      (cập nhật lúc {formatDateTime(currentWorkshop.last_synced_at)})
                    </span>
                  )}
                </h2>

                <div className="grid sm:grid-cols-2 gap-6">
                  <div>
                    <div className="text-xs text-muted flex items-center gap-1.5 mb-1">
                      <span aria-hidden>📍</span> Địa điểm
                    </div>
                    <div className="font-semibold text-ink whitespace-pre-line">{currentWorkshop.location || "—"}</div>
                    {currentWorkshop.location && (
                      <a
                        href={"https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(currentWorkshop.location)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 mt-3 border border-line px-3 py-1.5 rounded-sm text-sm text-brand-teal hover:bg-brand/5"
                      >
                        <span aria-hidden>🗺️</span> Xem trên bản đồ
                      </a>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-muted flex items-center gap-1.5 mb-1">
                      <span aria-hidden>📅</span> Thời gian
                    </div>
                    <div className="font-semibold text-ink">{currentWorkshop.event_date || "—"}</div>
                  </div>
                </div>

                <hr className="my-5 border-line" />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1 auto-rows-fr">
                  <div className="bg-surface-muted border border-line rounded-md p-4">
                    <div className="text-xl" aria-hidden>👥</div>
                    <div className="text-sm text-muted mt-1">Khách tham gia đã đăng ký</div>
                    <div className="text-2xl font-bold text-brand-teal mt-2">
                      {totalRegistered} <span className="text-sm font-normal text-muted">khách</span>
                    </div>
                  </div>
                  <div className="bg-surface-muted border border-line rounded-md p-4">
                    <div className="text-xl" aria-hidden>📄</div>
                    <div className="text-sm text-muted mt-1">Số phiếu đăng ký</div>
                    <div className="text-2xl font-bold text-ink mt-2">
                      {totalRecords} <span className="text-sm font-normal text-muted">phiếu</span>
                    </div>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-md p-4">
                    <div className="text-xl" aria-hidden>✅</div>
                    <div className="text-sm text-muted mt-1">Khách đã check-in</div>
                    <div className="text-2xl font-bold text-green-700 mt-2">
                      {totalCheckedIn} <span className="text-sm font-normal text-muted">khách</span>
                    </div>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-md p-4">
                    <div className="text-xl" aria-hidden>📋</div>
                    <div className="text-sm text-muted mt-1">Số phiếu đã check-in</div>
                    <div className="text-2xl font-bold text-green-700 mt-2">
                      {checkedInRecords} <span className="text-sm font-normal text-muted">phiếu</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-3 flex flex-col gap-4 h-full">
                <div className="bg-surface rounded-md border border-line p-5 flex flex-col items-center flex-1 justify-center">
                  <div className="font-semibold text-brand-teal mb-1 flex items-center gap-1.5">
                    <span aria-hidden>🔳</span> QR CHECK-IN
                  </div>
                  <div className="text-xs text-muted mb-3 text-center">Khách quét QR để tự check-in</div>
                  <QrDisplay workshopSlug={currentWorkshop.slug} size={160} showActions />
                </div>
                <WelcomeLinkCard slug={currentWorkshop.slug} />
              </div>
            </div>
          )}
        </section>

        {/* Add guest */}
        <section className="bg-surface rounded-md border border-line p-4 mb-4">
          <h2 className="font-semibold text-brand-teal mb-2">Thêm khách</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <input
              placeholder="Họ và tên *"
              className="border border-line rounded-sm px-2 py-1"
              value={newGuest.full_name}
              onChange={(e) => setNewGuest({ ...newGuest, full_name: e.target.value })}
            />
            <input
              placeholder="Số điện thoại"
              className="border border-line rounded-sm px-2 py-1"
              value={newGuest.phone}
              onChange={(e) => setNewGuest({ ...newGuest, phone: e.target.value })}
            />
            <input
              placeholder="Mô hình kinh doanh"
              className="border border-line rounded-sm px-2 py-1"
              value={newGuest.business_model}
              onChange={(e) => setNewGuest({ ...newGuest, business_model: e.target.value })}
            />
            <input
              placeholder="Chức vụ"
              className="border border-line rounded-sm px-2 py-1"
              value={newGuest.role_title}
              onChange={(e) => setNewGuest({ ...newGuest, role_title: e.target.value })}
            />
            <input
              placeholder="Loại khách (VIP/Speaker/Press)"
              className="border border-line rounded-sm px-2 py-1"
              value={newGuest.guest_type}
              onChange={(e) => setNewGuest({ ...newGuest, guest_type: e.target.value })}
            />
            <input
              type="number"
              min={1}
              placeholder="Số khách"
              className="border border-line rounded-sm px-2 py-1"
              value={newGuest.party_size}
              onChange={(e) =>
                setNewGuest({ ...newGuest, party_size: Math.max(1, parseInt(e.target.value) || 1) })
              }
            />
          </div>
          <button
            onClick={createGuest}
            className="mt-2 bg-brand text-white px-3 py-1.5 rounded-sm text-sm"
          >
            Thêm
          </button>
        </section>

        {/* Guest list */}
        <section className="bg-surface rounded-md border border-line">
          <div className="sticky top-0 z-30 bg-surface/95 backdrop-blur border-b border-line px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-semibold text-brand-teal">
              Phiếu đã check-in: {checkedInRecords}/{totalRecords} · Khách đã check-in: {totalCheckedIn}/{totalRegistered}
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                className="border border-line rounded-sm px-3 py-2 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              >
                <option value="all">Tất cả</option>
                <option value="checked_in">Đã check-in</option>
                <option value="not_checked_in">Chưa check-in</option>
              </select>
              <input
                className="border border-line rounded-sm px-3 py-2 text-sm min-w-[240px]"
                placeholder="Tìm tên, SĐT, công ty..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="bg-surface-muted text-muted text-xs">
                <tr>
                  <th className="text-left px-3 py-3 min-w-[200px]">Tên khách</th>
                  <th className="text-left px-3 py-3">SĐT</th>
                  <th className="text-left px-3 py-3 min-w-[160px]">Mô hình kinh doanh</th>
                  <th className="text-center px-3 py-3 w-28">Số khách đăng ký</th>
                  <th className="text-center px-3 py-3 w-28">Số khách check-in</th>
                  <th className="text-center px-3 py-3 w-32">Check-in</th>
                  <th className="text-center px-3 py-3 w-28">Đồng bộ Lark</th>
                  <th className="text-left px-3 py-3 min-w-[160px]">Thao tác</th>
                  <th className="text-left px-3 py-3">Ngày đăng ký</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visibleGuests.map((g) => {
                  const vip = isVip(g);
                  return (
                    <tr key={g.id} className={(vip ? "bg-cyan-50" : "") + " hover:bg-brand/5"}>
                      <td className="px-3 py-3 align-top">
                        <div className="font-semibold text-ink">{g.full_name}</div>
                        <div className="mt-1 flex gap-1 flex-wrap">
                          {vip && <span className="text-xs px-2 py-0.5 rounded bg-cyan-200 text-cyan-900 font-semibold">VIP</span>}
                          {g.lark_record_id
                            ? <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">Đã đồng bộ</span>
                            : <span className="text-xs px-2 py-0.5 rounded bg-surface-muted text-muted">Chưa đồng bộ</span>}
                          {g.role_title && <span className="text-xs px-2 py-0.5 rounded bg-surface-muted text-muted">{g.role_title}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top whitespace-nowrap">
                        {g.phone ? (
                          <button
                            onClick={() => copyPhone(g.phone!)}
                            className="text-muted hover:text-brand-teal font-mono text-xs px-2 rounded min-h-[32px] flex items-center"
                            title="Copy DT"
                          >
                            {g.phone}
                          </button>
                        ) : <span className="text-muted">-</span>}
                      </td>
                      <td className="px-3 py-3 align-top text-muted" title={g.business_model || ""}>
                        {truncate(g.business_model, 60)}
                      </td>
                      <td className="px-3 py-3 align-top text-center">{g.party_size || 1}</td>
                      <td className="px-3 py-3 align-top text-center">
                        {g.checkin_status === "checked_in" ? (
                          (() => {
                            const registered = g.party_size || 1;
                            const actual = g.actual_party_size ?? registered;
                            const same = actual === registered;
                            return (
                              <span className={(same ? "text-cyan-600" : "text-red-600") + " font-semibold"}>
                                {actual}
                              </span>
                            );
                          })()
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-3 align-top">
                        {g.checkin_status === "checked_in" ? (
                          <button
                            onClick={() => doUncheckin(g)}
                            className="bg-green-50 text-green-700 font-semibold text-xs px-3 py-1.5 rounded-sm min-h-[32px] flex items-center justify-center w-full"
                          >
                            Đã check-in
                          </button>
                        ) : (
                          <button
                            onClick={() => doCheckin(g)}
                            className="border border-green-600 text-green-700 font-semibold text-xs px-3 py-1.5 rounded-sm hover:bg-green-50 min-h-[32px] flex items-center justify-center w-full"
                          >
                            Check-in
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex flex-col gap-1 items-center">
                          <SyncBadge status={g.sync_status} error={g.sync_error} />
                          {g.sync_status === "conflict" && (
                            <div className="flex gap-1 mt-1">
                              <button
                                onClick={() => resolveConflict(g, "local")}
                                className="text-xs text-blue-600 underline"
                              >
                                Local
                              </button>
                              <button
                                onClick={() => resolveConflict(g, "lark")}
                                className="text-xs text-purple-600 underline"
                              >
                                Lark
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top text-sm">
                        <div className="flex items-center gap-3 flex-wrap">
                          <button
                            onClick={() => openEdit(g)}
                            className="text-brand underline min-h-[32px] flex items-center"
                          >
                            Sửa
                          </button>
                          <button
                            onClick={() => toggleVip(g)}
                            className="text-muted underline min-h-[32px] flex items-center"
                          >
                            {vip ? "Bỏ VIP" : "VIP"}
                          </button>
                          <button
                            onClick={() => delGuest(g.id)}
                            className="text-red-600 underline min-h-[32px] flex items-center"
                          >
                            Xóa
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top text-muted text-xs whitespace-nowrap">
                        {formatDateTime(g.registered_at || g.created_at)}
                      </td>
                    </tr>
                  );
                })}
                {!visibleGuests.length && (
                  <tr><td colSpan={9} className="py-10 text-center text-muted">Không có khách khớp bộ lọc</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Edit modal */}
      {editId && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !editBusy && setEditId(null)}
        >
          <div className="bg-surface rounded-md border border-line p-5 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-brand-teal mb-3">Chỉnh sửa khách</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="col-span-2">
                <span className="block text-muted text-xs mb-1">Họ và tên *</span>
                <input
                  className="border border-line rounded-sm px-2 py-1.5 w-full"
                  value={ef.full_name}
                  onChange={(e) => setEf({ ...ef, full_name: e.target.value })}
                />
              </label>
              <label>
                <span className="block text-muted text-xs mb-1">Số điện thoại</span>
                <input
                  className="border border-line rounded-sm px-2 py-1.5 w-full"
                  value={ef.phone}
                  onChange={(e) => setEf({ ...ef, phone: e.target.value })}
                />
              </label>
              <label>
                <span className="block text-muted text-xs mb-1">Số vé</span>
                <input
                  type="number"
                  min={1}
                  className="border border-line rounded-sm px-2 py-1.5 w-full"
                  value={ef.party_size}
                  onChange={(e) => setEf({ ...ef, party_size: Math.max(1, parseInt(e.target.value) || 1) })}
                />
              </label>
              <label className="col-span-2">
                <span className="block text-muted text-xs mb-1">Mô hình kinh doanh</span>
                <input
                  className="border border-line rounded-sm px-2 py-1.5 w-full"
                  value={ef.business_model}
                  onChange={(e) => setEf({ ...ef, business_model: e.target.value })}
                />
              </label>
              <label>
                <span className="block text-muted text-xs mb-1">Chức vụ</span>
                <input
                  className="border border-line rounded-sm px-2 py-1.5 w-full"
                  value={ef.role_title}
                  onChange={(e) => setEf({ ...ef, role_title: e.target.value })}
                />
              </label>
              <label>
                <span className="block text-muted text-xs mb-1">Loại khách</span>
                <input
                  className="border border-line rounded-sm px-2 py-1.5 w-full"
                  value={ef.guest_type}
                  onChange={(e) => setEf({ ...ef, guest_type: e.target.value })}
                />
              </label>
              <label className="col-span-2">
                <span className="block text-muted text-xs mb-1">Ghi chú</span>
                <textarea
                  className="border border-line rounded-sm px-2 py-1.5 w-full resize-none"
                  rows={2}
                  value={ef.note || ""}
                  onChange={(e) => setEf({ ...ef, note: e.target.value })}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setEditId(null)}
                disabled={editBusy}
                className="border border-line px-3 py-1.5 rounded-sm text-sm disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                onClick={saveEdit}
                disabled={editBusy || !ef.full_name}
                className="bg-brand text-white px-3 py-1.5 rounded-sm text-sm disabled:opacity-50"
              >
                {editBusy ? "Đang lưu..." : "Lưu & đồng bộ Lark"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lark pull modal */}
      {larkOpen && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !larkBusy && setLarkOpen(false)}
        >
          <div className="bg-surface rounded-md border border-line p-5 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-brand-teal mb-1">Kéo dữ liệu từ Lark</h3>
            <p className="text-xs text-muted mb-3">
              Kéo khách từ Lark Base về local. Workshop trong Lark phải khớp với workshop hiện tại.
            </p>
            {larkLoading ? (
              <div className="text-sm text-muted py-4">Đang tải danh sách workshop từ Lark...</div>
            ) : (
              <>
                <label className="block text-muted text-xs mb-1">Workshop (Lark)</label>
                <select
                  className="border border-line rounded-sm px-3 py-2 w-full mb-2"
                  value={larkPick}
                  onChange={(e) => setLarkPick(e.target.value)}
                >
                  {larkWs.map((w) => (
                    <option key={w.lark_workshop_name} value={w.lark_workshop_name}>
                      {w.lark_workshop_name}{w.event_date ? " — " + w.event_date : ""}
                    </option>
                  ))}
                </select>
              </>
            )}
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={() => setLarkOpen(false)}
                disabled={larkBusy}
                className="border border-line px-3 py-1.5 rounded-sm text-sm disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                onClick={runLarkPull}
                disabled={larkBusy || larkLoading || !larkPick}
                className="bg-brand text-white px-3 py-1.5 rounded-sm text-sm disabled:opacity-50"
              >
                {larkBusy ? "Đang kéo..." : "Kéo từ Lark"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}