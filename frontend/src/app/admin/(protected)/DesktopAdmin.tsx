"use client";
import { Fragment, useEffect, useMemo, useState, type MouseEvent } from "react";
import QrDisplay from "@/components/QrDisplay";
import { api, downloadGuestsXlsx } from "@/lib/api";
import { BUSINESS_MODEL_OPTIONS } from "@/lib/business-models";
import { GUEST_SOURCE_OPTIONS } from "@/lib/guest-sources";
import { useAdminGuests, type Guest, type ZbsDelivery } from "@/hooks/useAdminGuests";
import ColumnVisibilityMenu from "@/components/ColumnVisibilityMenu";
import GuestQr from "@/components/GuestQr";
import GuestDetailRow from "@/components/GuestDetailRow";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";
import WorkshopPicker from "@/components/WorkshopPicker";
import { formatEventDateTime, formatTimestamp } from "@/lib/date-format";

type ColumnKey = "name" | "phone" | "businessModel" | "source" | "creator" | "registered" | "checkedIn" | "checkin" | "qr" | "sync" | "zbs" | "actions" | "registeredAt";
const TABLE_COLUMNS = [
  { key: "name", label: "Tên khách" }, { key: "phone", label: "SĐT" }, { key: "businessModel", label: "Mô hình kinh doanh" },
  { key: "source", label: "Nguồn" }, { key: "creator", label: "Người tạo" },
  { key: "registered", label: "Số khách đăng ký" }, { key: "checkedIn", label: "Số khách check-in" },
  { key: "checkin", label: "Check-in" }, { key: "qr", label: "QR" }, { key: "sync", label: "Đồng bộ Lark" },
  { key: "zbs", label: "ZBS" },
  { key: "actions", label: "Thao tác" }, { key: "registeredAt", label: "Ngày đăng ký" },
] as const;

function truncate(s: string | null | undefined, n = 40): string {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function isVip(g: Guest): boolean {
  return (g.guest_type || "").trim().toLowerCase() === "vip";
}

function SyncBadge({ status, error }: { status?: string; error?: string | null }) {
  if (status === "synced") {
    return <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">Đã gửi</span>;
  }
  if (status === "error") {
    return (
      <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700" title={error || ""}>
        Lỗi đồng bộ
      </span>
    );
  }
  if (status === "pending_push") {
    return <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600">Chờ gửi</span>;
  }
  return <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">—</span>;
}

function ZbsBadge({ label, delivery, onRetry }: { label: string; delivery?: ZbsDelivery; onRetry: (delivery: ZbsDelivery) => void }) {
  if (!delivery) return <span className="text-[10px] text-muted">{label}: chưa tạo</span>;
  const failed = delivery.status === "failed";
  const text = delivery.status === "delivered" ? "đã nhận" : delivery.status === "sent" ? "đã gửi" : delivery.status === "sending" ? "đang gửi" : delivery.status === "pending" ? "chờ gửi" : delivery.status === "expired" ? "quá hạn" : delivery.status === "cancelled" ? "đã hủy" : "lỗi";
  return <span className={`text-[10px] ${failed ? "text-red-600" : delivery.status === "delivered" ? "text-green-700" : "text-muted"}`} title={delivery.last_error || ""}>{label}: {text}{failed && <button className="ml-1 underline" onClick={() => onRetry(delivery)}>gửi lại</button>}</span>;
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
 * Lark write-back + edit modal là desktop-only: giữ state cục bộ tại đây,
 * gọi reload()/refreshWorkshops()/setWid() từ hook để đồng bộ.
 */
export default function DesktopAdmin() {
  const { can } = useAuth();
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
    confirmRegistration,
    doUncheckin,
    toggleVip,
    copyPhone,
    importFile,
    reload,
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
    retryZbs,
    sendZbsManually,
    guestDetails,
    loadGuestDetail,
  } = useAdminGuests();
  const defaultVisibleColumns: ColumnKey[] = [
    "name", "phone", "businessModel", "source", "creator",
    "registered", "checkedIn", "checkin", "actions", "registeredAt",
  ];
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>(() =>
    Object.fromEntries(TABLE_COLUMNS.map(({ key }) => [key, defaultVisibleColumns.includes(key)])) as Record<ColumnKey, boolean>);
  const visibleColumnCount = TABLE_COLUMNS.filter(({ key }) => visibleColumns[key]).length;
  const [expandedGuestId, setExpandedGuestId] = useState<string | null>(null);
  const [showAdminTools, setShowAdminTools] = useState(false);
  const [showAddGuest, setShowAddGuest] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  const pageCount = Math.max(1, Math.ceil(visibleGuests.length / pageSize));
  const page = Math.min(currentPage, pageCount);
  const pagedGuests = useMemo(
    () => visibleGuests.slice((page - 1) * pageSize, page * pageSize),
    [visibleGuests, page, pageSize],
  );
  const firstRow = visibleGuests.length ? (page - 1) * pageSize + 1 : 0;
  const lastRow = Math.min(page * pageSize, visibleGuests.length);

  const toggleGuestDetail = (guestId: string) => {
    setExpandedGuestId((current) => current === guestId ? null : guestId);
    if (expandedGuestId !== guestId) void loadGuestDetail(guestId);
  };

  const onGuestRowClick = (event: MouseEvent<HTMLTableRowElement>, guestId: string) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, label, [data-row-action]")) return;
    toggleGuestDetail(guestId);
  };

  useEffect(() => {
    setCurrentPage(1);
    setExpandedGuestId(null);
  }, [wid, search, statusFilter, pageSize]);

  useEffect(() => {
    if (currentPage > pageCount) setCurrentPage(pageCount);
  }, [currentPage, pageCount]);

  useEffect(() => {
    setExpandedGuestId(null);
  }, [page]);

  useEffect(() => {
    if (expandedGuestId && !visibleGuests.some((guest) => guest.id === expandedGuestId)) {
      setExpandedGuestId(null);
    }
  }, [expandedGuestId, visibleGuests]);

  // ----- Lark write-back (desktop-only) -----
  const [larkBusy, setLarkBusy] = useState(false);

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

  // ----- Edit modal (desktop-only) -----
  const [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState<any>({});
  const [editBusy, setEditBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const runExport = async () => {
    setExportBusy(true);
    setMsg("Đang xuất Excel...");
    try {
      await downloadGuestsXlsx({
        workshopIds: wid ? [wid] : undefined,
        status: statusFilter,
        filename:
          "guests_" +
          (wid ? wid.slice(0, 8) : "all") +
          "_" +
          new Date().toISOString().slice(0, 10) +
          ".xlsx",
      });
      setMsg("Đã xuất Excel");
    } catch (e: any) {
      setMsg("Xuất Excel thất bại: " + (e?.message || "không rõ"));
    } finally {
      setExportBusy(false);
    }
  };

  const openEdit = (g: Guest) => {
    setEditId(g.id);
    setEf({
      full_name: g.full_name || "",
      phone: g.phone || "",
      business_model: g.business_model || "",
      party_size: g.party_size || 1,
      is_vip: isVip(g),
    });
  };

  const saveEdit = async () => {
    if (!editId || editBusy) return;
    const full_name = (ef.full_name || "").trim();
    const phone = (ef.phone || "").trim();
    const business_model = (ef.business_model || "").trim();
    const party_size = Math.max(1, parseInt(String(ef.party_size), 10) || 1);
    if (!full_name || !phone || !business_model) {
      setMsg("Vui lòng nhập Họ tên, SĐT, Số khách và chọn Mô hình kinh doanh.");
      return;
    }
    setEditBusy(true);
    try {
      const res = await api<any>("/guests/" + editId + "?sync_lark=true", {
        method: "PATCH",
        body: JSON.stringify({
          full_name,
          phone,
          business_model,
          party_size,
          guest_type: ef.is_vip ? "vip" : null,
        }),
      });
      const errStr = res.lark_error ? " (Lỗi Lark: " + res.lark_error + ")" : "";
      setMsg("Đã lưu & đồng bộ Lark" + errStr);
      setEditId(null);
      await reload();
      await loadGuestDetail(editId, true);
    } catch (e: any) {
      setMsg("Lỗi lưu: " + (e?.message || "không rõ"));
    } finally {
      setEditBusy(false);
    }
  };

  // ----- Render -----
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] p-6">
      <div className="max-w-7xl mx-auto flex min-h-[calc(100dvh-6.5rem)] flex-col">
        <h1 className="text-2xl font-bold text-brand-teal mb-4">Khách mời</h1>
        {msg && (
          <div className="mb-3 p-2 bg-brand/10 text-brand-teal rounded-sm text-sm flex items-center justify-between">
            <span>{msg}</span>
            <button onClick={() => setMsg("")} className="text-muted text-lg leading-none">×</button>
          </div>
        )}

        {/* Workshop info */}
        <section className="contents">
          <div className="order-1 bg-surface rounded-md border border-line p-4 mb-4 flex items-center gap-3 flex-wrap justify-between">
            <div className="w-full max-w-xl"><WorkshopPicker workshops={workshops} value={wid} onChange={setWid} /></div>
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={() => setShowAddGuest((value) => !value)} className="min-h-10 rounded-md border border-brand bg-brand px-4 text-sm font-semibold text-brand-teal">{showAddGuest ? "Đóng form thêm khách" : "Thêm khách"}</button>
              <button type="button" aria-expanded={showAdminTools} onClick={() => setShowAdminTools((value) => !value)} className="min-h-10 rounded-md border border-line px-4 text-sm font-semibold text-brand-teal">{showAdminTools ? "Ẩn công cụ quản trị" : "Công cụ quản trị"}</button>
            </div>
            {showAdminTools && <div className="flex w-full items-center gap-2 flex-wrap border-t border-line pt-3">
              <button
                onClick={runLarkPush}
                disabled={larkBusy || !wid}
                className="border border-brand text-brand px-3 py-2 rounded-sm text-sm disabled:opacity-50"
              >
                Đẩy lên Lark
              </button>
              <button
                onClick={runExport}
                disabled={exportBusy}
                className="border border-line px-3 py-2 rounded-sm text-sm disabled:opacity-50"
              >
                {exportBusy ? "Đang xuất..." : "Xuất Excel"}
              </button>
              <label className="border border-line px-3 py-2 rounded-sm text-sm cursor-pointer">
                Nhập CSV/XLSX
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
                />
              </label>
            </div>}
          </div>

          {showAdminTools && currentWorkshop && (
            <div className="order-2 grid lg:grid-cols-10 gap-4 mb-4 items-stretch">
              <div className="lg:col-span-7 h-full bg-surface rounded-md border border-line p-5 flex flex-col">
                <h2 className="font-semibold text-brand-teal mb-4 flex items-center gap-1.5">
                  Thông tin Workshop
                  {currentWorkshop.last_synced_at && (
                    <span className="font-normal text-xs text-muted ml-1">
                      (cập nhật lúc {formatTimestamp(currentWorkshop.last_synced_at)})
                    </span>
                  )}
                </h2>

                <div className="grid sm:grid-cols-2 gap-6">
                  <div>
                    <div className="text-xs text-muted flex items-center gap-1.5 mb-1">
                      Địa điểm
                    </div>
                    <div className="font-semibold text-ink whitespace-pre-line">{currentWorkshop.location || "—"}</div>
                    {currentWorkshop.location && (
                      <a
                        href={"https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(currentWorkshop.location)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 mt-3 border border-line px-3 py-1.5 rounded-sm text-sm text-brand-teal hover:bg-brand/5"
                      >
                        Xem trên bản đồ
                      </a>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-muted flex items-center gap-1.5 mb-1">
                      Thời gian
                    </div>
                    <div className="font-semibold text-ink">
                      {formatEventDateTime(currentWorkshop.event_date, currentWorkshop.event_time, true)}
                    </div>
                  </div>
                </div>

                <hr className="my-5 border-line" />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1 auto-rows-fr">
                  <div className="bg-surface-muted border border-line rounded-md p-4">
                    <div className="text-sm text-muted mt-1">Khách tham gia đã đăng ký</div>
                    <div className="text-2xl font-bold text-brand-teal mt-2">
                      {totalRegistered} <span className="text-sm font-normal text-muted">khách</span>
                    </div>
                  </div>
                  <div className="bg-surface-muted border border-line rounded-md p-4">
                    <div className="text-sm text-muted mt-1">Số phiếu đăng ký</div>
                    <div className="text-2xl font-bold text-ink mt-2">
                      {totalRecords} <span className="text-sm font-normal text-muted">phiếu</span>
                    </div>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-md p-4">
                    <div className="text-sm text-muted mt-1">Khách đã check-in</div>
                    <div className="text-2xl font-bold text-green-700 mt-2">
                      {totalCheckedIn} <span className="text-sm font-normal text-muted">khách</span>
                    </div>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-md p-4">
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
                    QR CHECK-IN
                  </div>
                  <div className="text-xs text-muted mb-3 text-center">Khách quét QR để tự check-in</div>
                  <QrDisplay workshopSlug={currentWorkshop.slug} size={160} showActions />
                </div>
                <WelcomeLinkCard slug={currentWorkshop.slug} />
              </div>
            </div>
          )}
        </section>

        {/* Add guest — cùng field với form đăng ký + VIP */}
        {showAddGuest && <section className="order-3 bg-surface rounded-md border border-line p-4 mb-4">
          <h2 className="font-semibold text-brand-teal mb-2">Thêm khách</h2>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="block min-w-[160px] flex-1">
              <span className="block text-muted text-xs mb-1">Họ và tên *</span>
              <input
                className="border border-line rounded-sm px-2 py-1.5 w-full"
                value={newGuest.full_name}
                onChange={(e) => setNewGuest({ ...newGuest, full_name: e.target.value })}
                placeholder="Nguyễn Văn A"
              />
            </label>
            <label className="block w-[140px] shrink-0">
              <span className="block text-muted text-xs mb-1">Số điện thoại *</span>
              <input
                inputMode="tel"
                className="border border-line rounded-sm px-2 py-1.5 w-full"
                value={newGuest.phone}
                onChange={(e) => setNewGuest({ ...newGuest, phone: e.target.value })}
                placeholder="0909 123 456"
              />
            </label>
            <label className="block w-[88px] shrink-0">
              <span className="block text-muted text-xs mb-1">Số khách *</span>
              <input
                type="number"
                min={1}
                className="border border-line rounded-sm px-2 py-1.5 w-full"
                value={newGuest.party_size}
                onChange={(e) =>
                  setNewGuest({ ...newGuest, party_size: Math.max(1, parseInt(e.target.value) || 1) })
                }
              />
            </label>
            <label className="block min-w-[200px] flex-[1.2]">
              <span className="block text-muted text-xs mb-1">Mô hình kinh doanh *</span>
              <select
                className="border border-line rounded-sm px-2 py-1.5 w-full bg-surface"
                value={newGuest.business_model}
                onChange={(e) => setNewGuest({ ...newGuest, business_model: e.target.value })}
              >
                <option value="" disabled>
                  — Chọn mô hình phù hợp —
                </option>
                {BUSINESS_MODEL_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-[220px] flex-[1.2]">
              <span className="block text-muted text-xs mb-1">Nguồn *</span>
              <select
                className="border border-line rounded-sm px-2 py-1.5 w-full bg-surface"
                value={newGuest.source}
                onChange={(e) => setNewGuest({ ...newGuest, source: e.target.value, source_detail: "" })}
              >
                <option value="" disabled>— Chọn nguồn —</option>
                {GUEST_SOURCE_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </label>
            {newGuest.source === "Khác" && (
              <label className="block min-w-[200px] flex-1">
                <span className="block text-muted text-xs mb-1">Ghi rõ nguồn *</span>
                <input
                  className="border border-line rounded-sm px-2 py-1.5 w-full"
                  value={newGuest.source_detail}
                  onChange={(e) => setNewGuest({ ...newGuest, source_detail: e.target.value })}
                  placeholder="Nhập nguồn cụ thể"
                />
              </label>
            )}
            <label className="flex items-center gap-2 text-sm cursor-pointer shrink-0 pb-2">
              <input
                type="checkbox"
                checked={newGuest.is_vip}
                onChange={(e) => setNewGuest({ ...newGuest, is_vip: e.target.checked })}
              />
              <span>Khách VIP</span>
            </label>
          </div>
          <button
            onClick={createGuest}
            disabled={
              !newGuest.full_name.trim() ||
              !newGuest.phone.trim() ||
              !newGuest.business_model ||
              !newGuest.source ||
              (newGuest.source === "Khác" && !newGuest.source_detail.trim()) ||
              !wid
            }
            className="mt-3 bg-brand text-brand-teal px-3 py-1.5 rounded-sm text-sm font-semibold disabled:opacity-40"
          >
            Thêm
          </button>
        </section>}

        {/* Guest list */}
        <section className={`order-4 overflow-hidden bg-surface rounded-md border border-line mb-4 flex min-h-[24rem] flex-col ${showAdminTools || showAddGuest ? "" : "flex-1"}`}>
          <div className="bg-surface border-b border-line px-4 py-3 flex shrink-0 items-center justify-between gap-3 flex-wrap">
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
              <ColumnVisibilityMenu columns={TABLE_COLUMNS} visible={visibleColumns} onChange={setVisibleColumns} />
            </div>
          </div>

          <div className="admin-table-scroll min-h-0 max-h-none flex-1 overscroll-x-contain overscroll-y-auto">
            <table className="min-w-[1100px] w-full text-sm">
              <thead className="bg-surface-muted text-left text-muted">
                <tr>
                  {visibleColumns.name && <th className="px-3 py-2 font-medium min-w-[200px]">Tên khách</th>}
                  {visibleColumns.phone && <th className="px-3 py-2 font-medium">SĐT</th>}
                  {visibleColumns.businessModel && <th className="px-3 py-2 font-medium min-w-[160px]">Mô hình kinh doanh</th>}
                  {visibleColumns.source && <th className="px-3 py-2 font-medium min-w-[180px]">Nguồn</th>}
                  {visibleColumns.creator && <th className="px-3 py-2 font-medium min-w-[130px]">Người tạo</th>}
                  {visibleColumns.registered && <th className="text-center px-3 py-2 font-medium w-28">Số khách đăng ký</th>}
                  {visibleColumns.checkedIn && <th className="text-center px-3 py-2 font-medium w-28">Số khách check-in</th>}
                   {visibleColumns.checkin && <th className="text-center px-3 py-2 font-medium w-32">Check-in</th>}
                   {visibleColumns.qr && <th className="text-center px-3 py-2 font-medium w-24">QR</th>}
                   {visibleColumns.sync && <th className="text-center px-3 py-2 font-medium w-28">Đồng bộ Lark</th>}
                   {visibleColumns.zbs && <th className="text-center px-3 py-2 font-medium min-w-[130px]">ZBS</th>}
                  {visibleColumns.actions && <th className="text-right px-3 py-2 font-medium min-w-[160px]">Thao tác</th>}
                  {visibleColumns.registeredAt && <th className="px-3 py-2 font-medium">Ngày đăng ký</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                 {pagedGuests.map((g) => {
                   const vip = isVip(g);
                   const expanded = expandedGuestId === g.id;
                   return (
                     <Fragment key={g.id}>
                     <tr
                       tabIndex={0}
                       aria-expanded={expanded}
                       onClick={(event) => onGuestRowClick(event, g.id)}
                       onKeyDown={(event) => {
                         if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
                           event.preventDefault();
                           toggleGuestDetail(g.id);
                         }
                       }}
                       className={`${expanded ? "border-x-2 border-t-2 border-brand bg-cyan-50" : vip ? "bg-cyan-50" : ""} cursor-pointer hover:bg-brand/5 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand`}
                     >
                        {visibleColumns.name && <td className="px-3 py-2 align-top">
                         <div className="flex items-start justify-between gap-3">
                           <div className="font-semibold text-ink">{g.full_name}</div>
                           <svg className={`mt-0.5 shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                         </div>
                         <div className="mt-1 flex gap-1 flex-wrap">
                           {vip && <span className="text-xs px-2 py-0.5 rounded bg-cyan-200 text-cyan-900 font-semibold">VIP</span>}
                           <span className={`text-xs px-2 py-0.5 rounded font-semibold ${g.registration_status === "confirmed" ? "bg-green-50 text-green-700" : "bg-amber-100 text-amber-800"}`}>{g.registration_status === "confirmed" ? "Đã xác nhận" : "Chờ xác nhận"}</span>
                          {g.lark_record_id
                            ? <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">Đã đồng bộ</span>
                            : <span className="text-xs px-2 py-0.5 rounded bg-surface-muted text-muted">Chưa đồng bộ</span>}
                          {g.role_title && <span className="text-xs px-2 py-0.5 rounded bg-surface-muted text-muted">{g.role_title}</span>}
                        </div>
                      </td>}
                      {visibleColumns.phone && <td className="px-3 py-2 align-top whitespace-nowrap">
                        {g.phone ? (
                           <button
                             onClick={(event) => { event.stopPropagation(); void copyPhone(g.phone!); }}
                            className="text-muted hover:text-brand-teal font-mono text-xs px-2 rounded min-h-[32px] flex items-center"
                            title="Copy DT"
                          >
                            {g.phone}
                          </button>
                        ) : <span className="text-muted">-</span>}
                      </td>}
                      {visibleColumns.businessModel && <td className="px-3 py-2 align-top text-muted" title={g.business_model || ""}>
                        {truncate(g.business_model, 60)}
                      </td>}
                      {visibleColumns.source && <td className="px-3 py-2 align-top text-muted" title={g.source_detail || g.source || ""}>
                        {truncate(g.source === "Khác" && g.source_detail ? `Khác: ${g.source_detail}` : g.source, 60)}
                      </td>}
                      {visibleColumns.creator && <td className="px-3 py-2 align-top text-muted whitespace-nowrap">{g.creator_name || "—"}</td>}
                      {visibleColumns.registered && <td className="px-3 py-2 align-top text-center">{g.party_size || 1}</td>}
                      {visibleColumns.checkedIn && <td className="px-3 py-2 align-top text-center">
                         {g.registration_status !== "confirmed" ? (
                           <button
                             type="button"
                             disabled
                             className="flex min-h-[32px] w-full items-center justify-center rounded-sm border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800"
                           >
                             Cần xác nhận
                           </button>
                         ) : g.checkin_status === "checked_in" ? (
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
                      </td>}
                       {visibleColumns.checkin && <td className="px-3 py-2 align-top">
                        {g.checkin_status === "checked_in" ? (
                           <button
                             onClick={(event) => { event.stopPropagation(); void doUncheckin(g); }}
                            className="bg-green-50 text-green-700 font-semibold text-xs px-3 py-1.5 rounded-sm min-h-[32px] flex items-center justify-center w-full"
                          >
                            Đã check-in
                          </button>
                        ) : (
                           <button
                             onClick={(event) => { event.stopPropagation(); void doCheckin(g); }}
                            className="border border-green-600 text-green-700 font-semibold text-xs px-3 py-1.5 rounded-sm hover:bg-green-50 min-h-[32px] flex items-center justify-center w-full"
                          >
                            Check-in
                          </button>
                        )}
                       </td>}
                       {visibleColumns.qr && <td className="px-3 py-2 align-top">
                         <div onClick={(event) => event.stopPropagation()}>
                         {currentWorkshop && (
                           <GuestQr
                             guestId={g.id}
                             guestName={g.full_name}
                             workshopId={currentWorkshop.id}
                             workshopName={currentWorkshop.name}
                             compact
                           />
                         )}
                         </div>
                       </td>}
                        {visibleColumns.sync && <td className="px-3 py-2 align-top">
                         <div className="flex flex-col gap-1 items-center">
                            <SyncBadge status={g.sync_status} error={g.sync_error} />
                         </div>
                       </td>}
                       {visibleColumns.zbs && <td className="px-3 py-2 align-top">
                         <div className="flex flex-col gap-1 items-start">
                           <ZbsBadge label="ĐK" delivery={g.zbs?.registration_confirmation} onRetry={retryZbs} />
                           <ZbsBadge label="Check-in" delivery={g.zbs?.checkin_confirmation} onRetry={retryZbs} />
                         </div>
                       </td>}
                      {visibleColumns.actions && <td className="px-3 py-2 align-top text-sm">
                        <div className="flex flex-wrap justify-end gap-1">
                           {g.registration_status !== "confirmed" && <button
                             onClick={(event) => { event.stopPropagation(); void confirmRegistration(g); }}
                             className="rounded-sm border border-brand/30 px-2 py-1 text-xs font-semibold text-brand-teal"
                           >
                             Xác nhận
                           </button>}
                           <button
                             onClick={(event) => { event.stopPropagation(); openEdit(g); }}
                            className="rounded-sm border border-line px-2 py-1 text-xs text-brand hover:bg-surface-muted"
                          >
                            Sửa
                          </button>
                           <button
                             onClick={(event) => { event.stopPropagation(); void toggleVip(g); }}
                            className="rounded-sm border border-line px-2 py-1 text-xs text-muted hover:bg-surface-muted"
                          >
                            {vip ? "Bỏ VIP" : "VIP"}
                          </button>
                           <button
                             onClick={(event) => { event.stopPropagation(); void delGuest(g.id).then((deleted) => { if (deleted) setExpandedGuestId(null); }); }}
                            className="rounded-sm border border-red-200 px-2 py-1 text-xs text-red-600"
                          >
                            Xóa
                          </button>
                        </div>
                      </td>}
                      {visibleColumns.registeredAt && <td className="px-3 py-2 align-top text-muted text-xs whitespace-nowrap">
                         {formatTimestamp(g.registered_at || g.created_at)}
                      </td>}
                     </tr>
                     {expanded && currentWorkshop && <GuestDetailRow
                       detail={guestDetails[g.id]}
                       colSpan={visibleColumnCount}
                       workshopName={currentWorkshop.name}
                       workshopId={currentWorkshop.id}
                       onRetryLoad={() => void loadGuestDetail(g.id, true)}
                       onEdit={openEdit}
                        onCheckin={(guest) => void doCheckin(guest)}
                        onConfirmRegistration={(guest) => void confirmRegistration(guest)}
                       onUncheckin={(guest) => void doUncheckin(guest)}
                       onToggleVip={(guest) => void toggleVip(guest)}
                       onDelete={(guest) => void delGuest(guest.id).then((deleted) => { if (deleted) setExpandedGuestId(null); })}
                       onSendManualZbs={(guest, taskKey) => void sendZbsManually(guest, taskKey)}
                       canSendManualZbs={can(PERMISSIONS.zbsManage)}
                     />}
                     </Fragment>
                   );
                })}
                {!visibleGuests.length && (
                  <tr><td colSpan={visibleColumnCount} className="py-10 text-center text-muted">Không có khách khớp bộ lọc</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {visibleGuests.length > 0 && (
            <div className="admin-table-pagination flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-3 text-sm">
              <div className="text-muted">Hiển thị {firstRow}–{lastRow} trong tổng số {visibleGuests.length} khách</div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-muted">
                  Dòng/trang
                  <select
                    aria-label="Số khách hiển thị mỗi trang"
                    value={pageSize}
                    onChange={(event) => setPageSize(Number(event.target.value))}
                    className="rounded-sm border border-line bg-surface px-2 py-1 text-ink"
                  >
                    {[25, 50, 100, 150, 200].map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                </label>
                <button type="button" disabled={page <= 1} onClick={() => setCurrentPage(page - 1)} className="rounded-sm border border-line px-2 py-1 disabled:opacity-40">Trước</button>
                <span>Trang {page}/{pageCount}</span>
                <button type="button" disabled={page >= pageCount} onClick={() => setCurrentPage(page + 1)} className="rounded-sm border border-line px-2 py-1 disabled:opacity-40">Sau</button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Edit modal — cùng field với form đăng ký + VIP */}
      {editId && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !editBusy && setEditId(null)}
        >
          <div className="bg-surface rounded-md border border-line p-5 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-brand-teal mb-3">Chỉnh sửa khách</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <label className="sm:col-span-2">
                <span className="block text-muted text-xs mb-1">Họ và tên *</span>
                <input
                  className="border border-line rounded-sm px-2 py-1.5 w-full"
                  value={ef.full_name || ""}
                  onChange={(e) => setEf({ ...ef, full_name: e.target.value })}
                />
              </label>
              <label>
                <span className="block text-muted text-xs mb-1">Số điện thoại *</span>
                <input
                  inputMode="tel"
                  className="border border-line rounded-sm px-2 py-1.5 w-full"
                  value={ef.phone || ""}
                  onChange={(e) => setEf({ ...ef, phone: e.target.value })}
                />
              </label>
              <label>
                <span className="block text-muted text-xs mb-1">Số khách *</span>
                <input
                  type="number"
                  min={1}
                  className="border border-line rounded-sm px-2 py-1.5 w-full"
                  value={ef.party_size ?? 1}
                  onChange={(e) => setEf({ ...ef, party_size: Math.max(1, parseInt(e.target.value) || 1) })}
                />
              </label>
              <label className="sm:col-span-2">
                <span className="block text-muted text-xs mb-1">Mô hình kinh doanh *</span>
                <select
                  className="border border-line rounded-sm px-2 py-1.5 w-full bg-surface"
                  value={ef.business_model || ""}
                  onChange={(e) => setEf({ ...ef, business_model: e.target.value })}
                >
                  <option value="" disabled>
                    — Chọn mô hình phù hợp —
                  </option>
                  {/* Giữ value cũ nếu không nằm trong list chuẩn (data Lark legacy) */}
                  {ef.business_model &&
                    !(BUSINESS_MODEL_OPTIONS as readonly string[]).includes(ef.business_model) && (
                      <option value={ef.business_model}>{ef.business_model}</option>
                    )}
                  {BUSINESS_MODEL_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sm:col-span-2 flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!ef.is_vip}
                  onChange={(e) => setEf({ ...ef, is_vip: e.target.checked })}
                />
                <span>Khách VIP</span>
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
                disabled={
                  editBusy ||
                  !(ef.full_name || "").trim() ||
                  !(ef.phone || "").trim() ||
                  !(ef.business_model || "").trim()
                }
                className="bg-brand text-brand-teal px-3 py-1.5 rounded-sm text-sm font-semibold disabled:opacity-50"
              >
                {editBusy ? "Đang lưu..." : "Lưu & đồng bộ Lark"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
