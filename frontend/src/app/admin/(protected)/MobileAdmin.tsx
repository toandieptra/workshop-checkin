"use client";
import { useEffect, useRef, useState } from "react";
import QrDisplay from "@/components/QrDisplay";
import { useAdminGuests, type Guest, type NewGuestInput, type ZbsDelivery } from "@/hooks/useAdminGuests";
import { BUSINESS_MODEL_OPTIONS } from "@/lib/business-models";
import { GUEST_SOURCE_OPTIONS } from "@/lib/guest-sources";
import GuestQr from "@/components/GuestQr";
import GuestQrScanner from "@/components/GuestQrScanner";
import { getClientOrigin, getPublicOrigin } from "@/lib/urls";
import WorkshopPicker from "@/components/WorkshopPicker";
import { formatEventDateTime, shortLocation } from "@/lib/date-format";
import { useDialogFocus } from "@/hooks/useDialogFocus";

// =============================================================================
// Inline SVG icon set — stroke 1.8-2, kế thừa color qua currentColor.
// Nhỏ gọn, dùng chung cho toàn mobile view, không phụ thuộc thư viện ngoài.
// =============================================================================

type IconProps = React.SVGProps<SVGSVGElement>;

function IconSearch(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function IconCheck(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconClose(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" {...props}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function IconStar({ filled, ...props }: IconProps & { filled?: boolean }) {
  return filled ? (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2l2.5 6.5L21 9l-5 4.5L17.5 21 12 17l-5.5 4L8 13.5 3 9l6.5-.5L12 2z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function IconPhone(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.8a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0122 16.92z" />
    </svg>
  );
}

function IconCopy(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}

function IconArrowUp(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

function IconChevronDown(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function IconQrCode(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20v.01" />
    </svg>
  );
}

function IconPlus(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconMinus(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12h14" />
    </svg>
  );
}

function IconTrash(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
    </svg>
  );
}

function IconUser(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconLink(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </svg>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function isVip(g: Guest): boolean {
  return (g.guest_type || "").trim().toLowerCase() === "vip";
}

function SyncBadge({ status }: { status?: string }) {
  if (status === "synced") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand/10 text-brand">Lark ✓</span>;
  }
  if (status === "conflict") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800">Xung đột</span>;
  }
  if (status === "error") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">Lỗi Lark</span>;
  }
  if (status === "pending_push") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">Chờ Lark</span>;
  }
  return null;
}

function ZbsBadge({ label, delivery, onRetry }: { label: string; delivery?: ZbsDelivery; onRetry: (delivery: ZbsDelivery) => void }) {
  if (!delivery) return null;
  const failed = delivery.status === "failed";
  const text = delivery.status === "delivered" ? "✓" : delivery.status === "sent" ? "đã gửi" : delivery.status === "pending" ? "chờ" : delivery.status === "sending" ? "đang" : delivery.status === "expired" ? "quá hạn" : delivery.status === "cancelled" ? "đã hủy" : "lỗi";
  return <span className={`text-[10px] ${failed ? "text-red-600" : "text-muted"}`} title={delivery.last_error || ""}>{label}:{text}{failed && <button className="ml-1 underline" onClick={() => onRetry(delivery)}>lại</button>}</span>;
}

/** Format ISO date → "HH:MM". Trả "—" nếu không parse được. */
function formatHm(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

/** Chênh giữa actual và registered party size. null nếu không có hoặc không lệch. */
function partyDelta(g: Guest): number | null {
  if (g.checkin_status !== "checked_in") return null;
  const registered = g.party_size || 1;
  const actual = g.actual_party_size ?? registered;
  const diff = actual - registered;
  return diff === 0 ? null : diff;
}

/** Tách URL thành host (cyan) + rest (secondary). */
function splitUrl(url: string): { host: string; rest: string } {
  if (!url) return { host: "", rest: "" };
  try {
    const u = new URL(url);
    return { host: u.host, rest: u.pathname + u.search };
  } catch {
    const idx = url.indexOf("/", url.indexOf("://") + 3);
    if (idx === -1) return { host: url, rest: "" };
    return { host: url.slice(0, idx), rest: url.slice(idx) };
  }
}

// =============================================================================
// Main
// =============================================================================

/**
 * Mobile-first view cho trang Admin — tối giản, tập trung check-in tại sự kiện.
 *
 * Visual + interaction patterns được port từ Open Design mockup
 * `admin-khach-moi-mobile` (dieptra-design-systems, 375px).
 *
 * Ẩn so với desktop: bảng danh sách rộng, form thêm khách, import/export,
 * Lark sync (pull/push/full), edit modal chi tiết.
 */
export default function MobileAdmin() {
  const {
    workshops,
    wid,
    setWid,
    visibleGuests,
    guests,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    currentWorkshop,
    totalRegistered,
    totalCheckedIn,
    totalRecords,
    checkedInRecords,
    doCheckin,
    confirmRegistration,
    doUncheckin,
    toggleVip,
    copyPhone,
    msg,
    setMsg,
    newGuest,
    setNewGuest,
    createGuest,
    delGuest,
    retryZbs,
    reload,
  } = useAdminGuests();

  const [linkCopied, setLinkCopied] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [checkinGuest, setCheckinGuest] = useState<Guest | null>(null);
  const [showEventTools, setShowEventTools] = useState(false);
  const [origin, setOrigin] = useState(getPublicOrigin);

  useEffect(() => {
    if (!origin) setOrigin(getClientOrigin());
  }, [origin]);

  const welcomeUrl = currentWorkshop && origin
    ? `${origin}/welcome?w=${encodeURIComponent(currentWorkshop.slug)}`
    : "";

  const copyWelcomeLink = async () => {
    if (!welcomeUrl) return;
    try {
      await navigator.clipboard.writeText(welcomeUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      setMsg("Không thể copy link");
    }
  };

  const checkedInRecordCount = guests.filter((guest) => guest.checkin_status === "checked_in").length;
  const notCheckedInRecordCount = Math.max(0, totalRecords - checkedInRecordCount);
  const { host: welcomeHost, rest: welcomeRest } = splitUrl(welcomeUrl);
  const filterActive = statusFilter !== "all" || search.trim().length > 0;

  const openAddForm = (prefillPhone?: string) => {
    setNewGuest({
      full_name: "",
      phone: (prefillPhone ?? search).trim(),
      business_model: "",
      party_size: 1,
      is_vip: false,
      source: "",
      source_detail: "",
    });
    setShowAddForm(true);
  };

  return (
    <div className="pb-20">
      {/* ======= 1. Sticky header — workshop picker + 4 KPI cards ======= */}
      <section className="sticky top-14 z-10 bg-surface border-b border-line">
        <div className="px-3 pt-3 pb-2.5 flex items-center gap-2">
          <div className="flex-1 min-w-0"><WorkshopPicker workshops={workshops} value={wid} onChange={setWid} compact /></div>
          {currentWorkshop && (
            <span
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-success shrink-0"
              aria-label="Workshop đang được chọn"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              Đang chọn
            </span>
          )}
        </div>
        {currentWorkshop && (currentWorkshop.event_date || currentWorkshop.event_time || currentWorkshop.location) && (
          <p className="px-3 -mt-1 pb-2 text-xs leading-5 text-text-secondary">
            {formatEventDateTime(currentWorkshop.event_date, currentWorkshop.event_time, true)}{currentWorkshop.location ? ` · ${shortLocation(currentWorkshop.location)}` : ""}
          </p>
        )}

        <div className="grid grid-cols-4 gap-1.5 px-3 pb-3">
          <KpiCard label="Khách đăng ký" value={totalRegistered} tone="default" />
          <KpiCard label="Phiếu đăng ký" value={totalRecords} tone="default" />
          <KpiCard label="Khách đã vào" value={totalCheckedIn} tone="success" />
          <KpiCard label="Phiếu đã xử lý" value={checkedInRecords} tone="success" />
        </div>
      </section>

      {/* ======= 2. Toast — có icon + animation slide-in ======= */}
      {msg && (
        <div
          role={/^Lỗi|^Không thể|^Vui lòng/.test(msg) ? "alert" : "status"}
          aria-live={/^Lỗi|^Không thể|^Vui lòng/.test(msg) ? "assertive" : "polite"}
          className={`mx-3 mt-2 flex items-center gap-2 p-2.5 rounded-md text-sm border animate-toast-in ${
            /^Lỗi|^Không thể|^Vui lòng/.test(msg)
              ? "bg-red-50 border-red-200 text-red-700"
              : "bg-success-soft border-success-border text-brand-teal"
          }`}
        >
          <span className={`w-5 h-5 rounded-full text-white inline-flex items-center justify-center shrink-0 ${/^Lỗi|^Không thể|^Vui lòng/.test(msg) ? "bg-error" : "bg-success"}`}>
            {/^Lỗi|^Không thể|^Vui lòng/.test(msg) ? <IconClose className="w-3 h-3" /> : <IconCheck className="w-3 h-3" />}
          </span>
          <span className="leading-snug flex-1 min-w-0">{msg}</span>
          <button
            onClick={() => setMsg("")}
            aria-label="Đóng thông báo"
            className="p-1 -mr-1 rounded text-text-secondary hover:bg-brand/5 hover:text-brand-teal"
          >
            <IconClose className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ======= 3. Search + status dropdown + Thêm khách ======= */}
      <section className="px-3 mt-3">
        <div className="relative">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
          <input
            type="search"
            className="w-full pl-9 pr-9 py-2.5 border border-line rounded-md text-sm bg-surface text-brand-teal placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
            placeholder="Tìm tên, SĐT, công ty..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Xóa tìm kiếm"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md bg-surface-muted text-brand-teal inline-flex items-center justify-center"
            >
              <IconClose className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="flex gap-2 mt-2">
          <div className="grid grid-cols-3 gap-1 flex-1 min-w-0" aria-label="Lọc trạng thái check-in">
            {([
              ["all", "Tất cả", totalRecords],
              ["not_checked_in", "Chưa", notCheckedInRecordCount],
              ["checked_in", "Đã", checkedInRecordCount],
            ] as const).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={statusFilter === value}
                onClick={() => setStatusFilter(value)}
                className={`min-h-11 rounded-md border px-1 text-xs font-semibold ${statusFilter === value ? "border-brand bg-brand text-brand-teal" : "border-line bg-surface text-text-secondary"}`}
              >
                {label} <span className="font-mono">{count}</span>
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowScanner(true)}
            disabled={!currentWorkshop}
            className="inline-flex items-center justify-center gap-1 h-11 px-3 rounded-md text-[13px] font-bold border border-brand text-brand-teal bg-surface active:bg-cyan-pale shrink-0 disabled:opacity-40"
          >
            <IconQrCode className="w-3.5 h-3.5" />
            Quét QR
          </button>
          <button
            onClick={() => openAddForm()}
            className="inline-flex items-center justify-center gap-1 h-11 px-3 rounded-md text-[13px] font-bold border bg-brand text-brand-teal border-brand active:opacity-90 shrink-0"
          >
            <IconPlus className="w-3.5 h-3.5" />
            Thêm
          </button>
        </div>

        {filterActive && (
          <p className="text-[11px] text-muted mt-2">
            Hiển thị <strong className="text-brand-teal">{visibleGuests.length}</strong>{" "}
            trong <strong className="text-brand-teal">{totalRecords}</strong> phiếu
          </p>
        )}
      </section>

      {/* ======= 5. Guest card list ======= */}
      <section className="px-3 mt-3 flex flex-col gap-2.5">
        {visibleGuests.length === 0 ? (
          filterActive ? (
            <EmptyStateAddCustomer
              query={search.trim()}
              onAdd={() => openAddForm(search.trim())}
            />
          ) : (
            <div className="py-10 text-center text-muted text-sm bg-surface border border-line rounded-md">
              Không có khách khớp bộ lọc
            </div>
          )
        ) : (
          visibleGuests.map((g) => (
            <GuestCard
              key={g.id}
               g={g}
               onConfirmRegistration={() => confirmRegistration(g)}
               onCheckin={() => setCheckinGuest(g)}
              onUncheckin={() => doUncheckin(g)}
              onToggleVip={() => toggleVip(g)}
              onCopyPhone={() => g.phone && copyPhone(g.phone)}
              onDelete={() => delGuest(g.id)}
              onRetryZbs={retryZbs}
              workshopId={currentWorkshop?.id || ""}
              workshopName={currentWorkshop?.name || "Workshop"}
            />
          ))
        )}
      </section>

      {currentWorkshop && (
        <section className="mx-3 mt-3 overflow-hidden rounded-md border border-line bg-surface">
          <button type="button" aria-expanded={showEventTools} onClick={() => setShowEventTools((value) => !value)} className="flex min-h-11 w-full items-center justify-between px-3 text-sm font-semibold text-brand-teal">
            <span className="inline-flex items-center gap-2"><IconQrCode className="h-4 w-4" />Công cụ sự kiện</span>
            <IconChevronDown className={`h-4 w-4 transition-transform ${showEventTools ? "rotate-180" : ""}`} />
          </button>
          {showEventTools && <div className="grid grid-cols-2 gap-3 border-t border-line p-3">
            <div className="bg-surface border border-line rounded-md p-3 flex flex-col items-center shadow-sm">
              <PanelLabel icon={<IconQrCode className="w-3 h-3" />}>QR Check-in</PanelLabel>
              <div className="flex-1 flex items-center justify-center w-full"><QrDisplay workshopSlug={currentWorkshop.slug} size={108} showUrl={false} /></div>
            </div>
            <div className="bg-surface border border-error rounded-md p-3 flex flex-col shadow-sm">
              <PanelLabel icon={<IconLink className="w-3 h-3" />} className="text-error">Link Welcome</PanelLabel>
              <div className="font-mono text-xs leading-[1.35] rounded-md bg-surface-muted px-2 py-1.5 my-2 break-all flex-1 min-h-[40px] flex items-center" title={welcomeUrl}>
                {welcomeUrl ? <><span className="text-brand-teal font-medium">{welcomeHost}</span><span className="text-text-secondary">{welcomeRest}</span></> : <span className="text-muted">—</span>}
              </div>
              <div className="grid grid-cols-2 gap-1.5 mt-auto">
                <button onClick={copyWelcomeLink} className="min-h-11 rounded-sm text-xs font-semibold border border-line bg-surface-muted text-brand-teal">{linkCopied ? "Đã copy" : "Sao chép"}</button>
                <a href={welcomeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-sm text-xs font-bold border border-brand bg-brand text-brand-teal">Mở</a>
              </div>
            </div>
          </div>}
        </section>
      )}

      {/* ======= 6. Add-customer bottom sheet ======= */}
      {showAddForm && (
        <AddCustomerSheet
          newGuest={newGuest}
          setNewGuest={setNewGuest}
          onClose={() => setShowAddForm(false)}
          onSubmit={async () => {
            const ok = await createGuest();
            if (ok) {
              setShowAddForm(false);
              setSearch("");
            }
          }}
        />
      )}

      {showScanner && currentWorkshop && (
        <GuestQrScanner
          workshopId={currentWorkshop.id}
          workshopSlug={currentWorkshop.slug}
          onClose={() => setShowScanner(false)}
          onCheckedIn={async (guestName, actualPartySize) => {
            setMsg(`Đã check-in ${guestName} (${actualPartySize} khách)`);
            await reload();
          }}
        />
      )}

      {checkinGuest && (
        <CheckinSheet
          guest={checkinGuest}
          onClose={() => setCheckinGuest(null)}
          onConfirm={async (actual) => {
            await doCheckin(checkinGuest, actual);
            setCheckinGuest(null);
          }}
        />
      )}

      {/* ======= 7. Home indicator — iOS-style, mờ ======= */}
      <div className="h-6 flex items-center justify-center pb-[env(safe-area-inset-bottom)]">
        <div className="w-[120px] h-1 rounded-full bg-border-strong opacity-40" />
      </div>
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function PanelLabel({
  children,
  icon,
  className = "",
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-1 text-[10px] font-semibold tracking-wide text-brand-teal ${className}`}
    >
      {icon}
      {children}
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | "success";
}) {
  const cls =
    tone === "success"
      ? "bg-success-soft border-success-border"
      : "bg-surface-muted border-line";
  const labelCls = tone === "success" ? "text-success" : "text-text-secondary";
  const valueCls = tone === "success" ? "text-success" : "text-brand-teal";
  return (
    <div className={`${cls} border rounded-md px-2 py-2 text-center min-h-[64px] flex flex-col justify-center`}>
      <div className={`text-[10px] font-medium tracking-wide leading-tight ${labelCls}`}>{label}</div>
      <div className={`text-[18px] font-bold leading-tight mt-0.5 font-heading ${valueCls}`}>{value}</div>
    </div>
  );
}

const SWIPE_REVEAL_WIDTH = 88; // px — bề rộng nút Xoá lộ ra khi vuốt trái

function GuestCard({
  g,
  onConfirmRegistration,
  onCheckin,
  onUncheckin,
  onToggleVip,
  onCopyPhone,
  onDelete,
  onRetryZbs,
  workshopId,
  workshopName,
}: {
  g: Guest;
  onConfirmRegistration: () => void;
  onCheckin: () => void;
  onUncheckin: () => void;
  onToggleVip: () => void;
  onCopyPhone: () => void;
  onDelete: () => void;
  onRetryZbs: (delivery: ZbsDelivery) => void;
  workshopId: string;
  workshopName: string;
}) {
  const vip = isVip(g);
  const checked = g.checkin_status === "checked_in";
  const delta = partyDelta(g);
  const registered = g.party_size || 1;

  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const startOffset = useRef(0);
  const axis = useRef<"none" | "x" | "y">("none");

  const open = offset > 0;

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    startOffset.current = offset;
    axis.current = "none";
    setDragging(true);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0];
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;
    if (axis.current === "none") {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (axis.current !== "x") return; // để cuộn dọc bình thường
    const next = Math.min(SWIPE_REVEAL_WIDTH, Math.max(0, startOffset.current - dx));
    setOffset(next);
  };

  const onTouchEnd = () => {
    setDragging(false);
    if (axis.current === "x") {
      setOffset(offset > SWIPE_REVEAL_WIDTH * 0.4 ? SWIPE_REVEAL_WIDTH : 0);
    }
    axis.current = "none";
  };

  // Nếu đang mở, chạm vào nội dung sẽ đóng swipe thay vì kích hoạt action
  const guardAction = (fn: () => void) => () => {
    if (open) {
      setOffset(0);
      return;
    }
    fn();
  };

  return (
    <div className="relative overflow-hidden rounded-md">
      {/* Lớp dưới: nút Xoá lộ ra khi vuốt trái */}
      <div className="absolute inset-y-0 right-0 flex" style={{ width: SWIPE_REVEAL_WIDTH }} aria-hidden={!open}>
        <button
          type="button"
          disabled={!open}
          tabIndex={open ? 0 : -1}
          onClick={() => {
            onDelete();
            setOffset(0);
          }}
          aria-label="Xoá khách"
          className="flex-1 flex flex-col items-center justify-center gap-1 bg-error text-white text-[12px] font-semibold active:opacity-90"
        >
          <IconTrash className="w-4 h-4" />
          Xoá
        </button>
      </div>

      {/* Lớp trên: nội dung card, trượt theo offset */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: `translateX(-${offset}px)`,
          transition: dragging ? "none" : "transform 0.2s ease-out",
        }}
        className={`relative bg-surface border rounded-md p-3 shadow-sm ${
          vip
            ? "border-brand ring-1 ring-brand bg-gradient-to-b from-cyan-bg to-white"
            : "border-line"
        }`}
      >
      {/* Row 1: name + badges | count chip */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-heading font-bold text-[15px] tracking-tight text-brand-teal leading-snug truncate">
            {g.full_name}
          </div>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {vip && (
              <span className="inline-flex items-center gap-0.5 h-5 px-1.5 rounded text-[10px] font-semibold bg-brand-gold text-brand-gold-dark">
                <IconStar filled className="w-2.5 h-2.5" />
                VIP
              </span>
            )}
            <span className={`inline-flex h-5 items-center rounded px-1.5 text-[10px] font-semibold ${g.registration_status === "confirmed" ? "bg-green-50 text-green-700" : "bg-amber-100 text-amber-800"}`}>
              {g.registration_status === "confirmed" ? "Đã xác nhận" : "Chờ xác nhận"}
            </span>
            {g.role_title && (
              <span className="inline-flex items-center h-5 px-1.5 rounded text-[10px] font-semibold bg-surface-muted text-brand-teal">
                {g.role_title}
              </span>
            )}
            <SyncBadge status={g.sync_status} />
            <ZbsBadge label="ĐK" delivery={g.zbs?.registration_confirmation} onRetry={onRetryZbs} />
            <ZbsBadge label="Check-in" delivery={g.zbs?.checkin_confirmation} onRetry={onRetryZbs} />
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-0.5 text-[11px] font-semibold rounded-md px-1.5 py-1 shrink-0 ${
            delta && delta > 0
              ? "bg-error/10 text-error"
              : delta && delta < 0
                ? "bg-amber-50 text-warning"
                : "bg-surface-muted text-text-secondary"
          }`}
          title={`${registered} khách đăng ký`}
        >
          {delta && delta > 0 && <IconArrowUp className="w-2.5 h-2.5" />}
          {checked ? (g.actual_party_size ?? registered) : registered} khách
          {delta ? ` (${delta > 0 ? "+" : ""}${delta})` : ""}
        </span>
      </div>

      {/* Row 2: phone chip | meta */}
      <div className="mt-2 flex items-center gap-2 flex-wrap text-[12px]">
        {g.phone ? (
          <button
            onClick={guardAction(onCopyPhone)}
            className="inline-flex items-center gap-1 bg-surface-muted font-mono px-2 py-1 rounded-md text-text-secondary active:bg-cyan-bg"
            title="Sao chép SĐT"
          >
            <IconPhone className="w-3 h-3" />
            {g.phone}
            <IconCopy className="w-2.5 h-2.5 ml-0.5 text-muted" />
          </button>
        ) : (
          <span className="text-muted">—</span>
        )}
        {g.company && (
          <span className="text-muted truncate">
            · <strong className="font-medium text-brand-teal">{g.company}</strong>
          </span>
        )}
      </div>
      <div className="mt-2 text-[11px] leading-5 text-muted">
        <span>Nguồn: <strong className="font-medium text-brand-teal">{g.source === "Khác" && g.source_detail ? `Khác: ${g.source_detail}` : g.source || "—"}</strong></span>
        <span className="mx-1.5">·</span>
        <span>Người tạo: <strong className="font-medium text-brand-teal">{g.creator_name || "—"}</strong></span>
      </div>

      {/* Row 3: CTA + VIP toggle */}
      <div className="mt-3 grid grid-cols-[1fr_44px_80px] gap-2 [@media(pointer:fine)]:grid-cols-[1fr_44px_80px_44px]">
        {g.registration_status !== "confirmed" ? (
          <button
            onClick={guardAction(onConfirmRegistration)}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-md border border-brand bg-brand text-[13px] font-bold text-brand-teal active:opacity-90"
          >
            <IconCheck className="h-3.5 w-3.5" />
            Xác nhận đăng ký
          </button>
        ) : checked ? (
          <button
            onClick={guardAction(onUncheckin)}
            className="inline-flex items-center justify-center gap-1.5 h-11 rounded-md text-[13px] font-semibold border bg-success-soft text-success border-success-border active:opacity-90"
          >
            <IconCheck className="w-3.5 h-3.5" />
            Đã check-in · {formatHm(g.checked_in_at)}
          </button>
        ) : (
          <button
            onClick={guardAction(onCheckin)}
            className="inline-flex items-center justify-center gap-1.5 h-11 rounded-md text-[13px] font-bold border bg-brand text-brand-teal border-brand active:opacity-90"
          >
            <IconCheck className="w-3.5 h-3.5" />
            Check-in · {registered} khách
          </button>
        )}
        <button
          onClick={guardAction(onToggleVip)}
          aria-label={vip ? "Bỏ đánh dấu VIP" : "Đánh dấu VIP"}
          title={vip ? "Bỏ VIP" : "Đánh dấu VIP"}
          className={`inline-flex items-center justify-center h-11 rounded-md border ${
            vip
              ? "bg-brand-gold-soft border-brand-gold text-brand-gold"
              : "border-line text-muted bg-surface"
          }`}
        >
          <IconStar filled={vip} className="w-4 h-4" />
        </button>
        <GuestQr
          guestId={g.id}
          guestName={g.full_name}
          workshopId={workshopId}
          workshopName={workshopName}
        />
        <button
          type="button"
          onClick={guardAction(onDelete)}
          aria-label={`Xóa ${g.full_name}`}
          className="hidden h-11 items-center justify-center rounded-md border border-red-200 text-red-600 [@media(pointer:fine)]:inline-flex"
        >
          <IconTrash className="h-4 w-4" />
        </button>
      </div>
      </div>
    </div>
  );
}

// =============================================================================
// Empty state — search SĐT không khớp → gợi ý thêm nhanh
// =============================================================================

function EmptyStateAddCustomer({
  query,
  onAdd,
}: {
  query: string;
  onAdd: () => void;
}) {
  return (
    <div className="py-8 px-3 text-center bg-surface border border-dashed border-brand/40 rounded-md">
      <div className="w-10 h-10 mx-auto rounded-full bg-brand/10 text-brand inline-flex items-center justify-center mb-2">
        <IconSearch className="w-5 h-5" />
      </div>
      <p className="text-sm text-brand-teal font-semibold leading-snug">
        Không có khách khớp
        {query ? (
          <>
            {" "}
            <span className="font-mono text-brand">“{query}”</span>
          </>
        ) : null}
      </p>
      <p className="text-[11px] text-muted mt-1">
        Có thể khách ngoài danh sách — thêm nhanh để check-in.
      </p>
      <button
        onClick={onAdd}
        className="mt-3 inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-md text-[13px] font-bold border bg-brand text-brand-teal border-brand active:opacity-90"
      >
        <IconPlus className="w-3.5 h-3.5" />
        Thêm khách
      </button>
    </div>
  );
}

function CheckinSheet({
  guest,
  onClose,
  onConfirm,
}: {
  guest: Guest;
  onClose: () => void;
  onConfirm: (actual: number) => void | Promise<void>;
}) {
  const [actual, setActual] = useState(Math.max(1, guest.party_size || 1));
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, dialogRef, "#checkin-actual");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-labelledby="checkin-sheet-title">
      <button type="button" className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Đóng xác nhận check-in" />
      <div ref={dialogRef} tabIndex={-1} className="relative w-full max-w-md rounded-t-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl animate-sheet-up">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Xác nhận check-in</p>
            <h2 id="checkin-sheet-title" className="mt-1 font-heading text-xl font-bold text-brand-teal">{guest.full_name}</h2>
            <p className="mt-1 text-sm text-text-secondary">Đã đăng ký {Math.max(1, guest.party_size || 1)} khách</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="grid h-11 w-11 place-items-center rounded-md border border-line text-brand-teal" aria-label="Đóng">
            <IconClose className="h-4 w-4" />
          </button>
        </div>
        <label htmlFor="checkin-actual" className="mt-5 block text-sm font-semibold text-brand-teal">Số người tham gia thực tế</label>
        <div className="mt-2 grid h-12 grid-cols-[48px_1fr_48px] overflow-hidden rounded-md border border-line">
          <button type="button" onClick={() => setActual((value) => Math.max(1, value - 1))} disabled={actual <= 1 || busy} className="grid place-items-center text-brand-teal disabled:opacity-40" aria-label="Giảm số khách"><IconMinus className="h-4 w-4" /></button>
          <input id="checkin-actual" type="number" min={1} value={actual} onChange={(event) => setActual(Math.max(1, parseInt(event.target.value, 10) || 1))} className="border-x border-line bg-white text-center font-mono text-lg text-brand-teal focus:outline-none" />
          <button type="button" onClick={() => setActual((value) => value + 1)} disabled={busy} className="grid place-items-center text-brand-teal disabled:opacity-40" aria-label="Tăng số khách"><IconPlus className="h-4 w-4" /></button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="h-12 rounded-md border border-line font-semibold text-brand-teal">Hủy</button>
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); await onConfirm(actual); }} className="h-12 rounded-md bg-brand font-bold text-brand-teal disabled:opacity-50">{busy ? "Đang check-in..." : `Check-in · ${actual} khách`}</button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// AddCustomerSheet — bottom-sheet form thêm khách nhanh (mobile)
// =============================================================================

function AddCustomerSheet({
  newGuest,
  setNewGuest,
  onClose,
  onSubmit,
}: {
  newGuest: NewGuestInput;
  setNewGuest: React.Dispatch<React.SetStateAction<NewGuestInput>>;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Thêm khách nhanh"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Đóng"
      />

      {/* Sheet — trượt từ dưới lên, chiếm phần dưới màn hình */}
      <div className="relative w-full max-w-md bg-surface rounded-t-2xl shadow-xl animate-sheet-up pb-[env(safe-area-inset-bottom)]">
        {/* Handle */}
        <div className="pt-2 flex justify-center">
          <div className="w-10 h-1 rounded-full bg-border-strong opacity-50" />
        </div>

        {/* Header */}
        <div className="px-4 pt-2 pb-3 flex items-center gap-2 border-b border-line">
          <div className="w-7 h-7 rounded-full bg-brand/10 text-brand inline-flex items-center justify-center shrink-0">
            <IconUser className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-heading font-bold text-[15px] text-brand-teal leading-tight">
              Thêm khách nhanh
            </div>
            <p className="text-[11px] text-muted leading-tight">
              Thêm và check-in sau khi xác minh
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="w-8 h-8 rounded-md text-text-secondary hover:bg-brand/5 hover:text-brand-teal inline-flex items-center justify-center"
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <div className="px-4 py-3 space-y-3 max-h-[70vh] overflow-y-auto">
          <Field label="Họ tên" required>
            <input
              autoFocus
              type="text"
              value={newGuest.full_name}
              onChange={(e) =>
                setNewGuest({ ...newGuest, full_name: e.target.value })
              }
              placeholder="Nguyễn Văn A"
              className="w-full px-3 py-2 border border-line rounded-md text-sm bg-surface text-brand-teal placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
            />
          </Field>

          <Field label="Số điện thoại" required>
            <input
              type="tel"
              inputMode="numeric"
              value={newGuest.phone}
              onChange={(e) =>
                setNewGuest({ ...newGuest, phone: e.target.value })
              }
              placeholder="0901234567"
              className="w-full px-3 py-2 border border-line rounded-md text-sm font-mono bg-surface text-brand-teal placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Số khách" required>
              <div className="flex items-stretch h-[38px] border border-line rounded-md overflow-hidden bg-surface focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
                <button
                  type="button"
                  aria-label="Giảm số khách"
                  disabled={newGuest.party_size <= 1}
                  onClick={() =>
                    setNewGuest({
                      ...newGuest,
                      party_size: Math.max(1, newGuest.party_size - 1),
                    })
                  }
                  className="px-3 flex items-center justify-center text-brand-teal disabled:opacity-40 active:bg-brand/10"
                >
                  <IconMinus className="w-3.5 h-3.5" />
                </button>
                <input
                  type="number"
                  min={1}
                  value={newGuest.party_size}
                  onChange={(e) =>
                    setNewGuest({
                      ...newGuest,
                      party_size: Math.max(1, parseInt(e.target.value) || 1),
                    })
                  }
                  className="flex-1 w-full min-w-0 text-center text-sm bg-surface text-brand-teal border-x border-line focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  aria-label="Tăng số khách"
                  onClick={() =>
                    setNewGuest({
                      ...newGuest,
                      party_size: newGuest.party_size + 1,
                    })
                  }
                  className="px-3 flex items-center justify-center text-brand-teal active:bg-brand/10"
                >
                  <IconPlus className="w-3.5 h-3.5" />
                </button>
              </div>
            </Field>

            <Field label="VIP">
              <label className="h-[38px] px-3 inline-flex items-center gap-2 border border-line rounded-md text-sm text-brand-teal bg-surface">
                <input
                  type="checkbox"
                  checked={newGuest.is_vip}
                  onChange={(e) =>
                    setNewGuest({ ...newGuest, is_vip: e.target.checked })
                  }
                  className="w-4 h-4 accent-brand"
                />
                <IconStar filled={newGuest.is_vip} className="w-3.5 h-3.5 text-brand-gold" />
                Đánh dấu VIP
              </label>
            </Field>
          </div>

          <Field label="Mô hình kinh doanh" required>
            <select
              value={newGuest.business_model}
              onChange={(e) =>
                setNewGuest({ ...newGuest, business_model: e.target.value })
              }
              className="w-full px-3 py-2 border border-line rounded-md text-sm bg-surface text-brand-teal focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
            >
              <option value="">— Chọn —</option>
              {BUSINESS_MODEL_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Nguồn" required>
            <select
              value={newGuest.source}
              onChange={(e) => setNewGuest({ ...newGuest, source: e.target.value, source_detail: "" })}
              className="w-full px-3 py-2 border border-line rounded-md text-sm bg-surface text-brand-teal focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
            >
              <option value="">— Chọn —</option>
              {GUEST_SOURCE_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </Field>
          {newGuest.source === "Khác" && (
            <Field label="Ghi rõ nguồn" required>
              <input
                value={newGuest.source_detail}
                onChange={(e) => setNewGuest({ ...newGuest, source_detail: e.target.value })}
                placeholder="Nhập nguồn cụ thể"
                className="w-full px-3 py-2 border border-line rounded-md text-sm bg-surface text-brand-teal placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
              />
            </Field>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-line grid grid-cols-2 gap-2">
          <button
            onClick={onClose}
            className="h-10 rounded-md text-[13px] font-semibold border border-line bg-surface text-brand-teal active:bg-cyan-pale"
          >
            Hủy
          </button>
          <button
            onClick={onSubmit}
            disabled={
              !newGuest.full_name.trim() ||
              !newGuest.phone.trim() ||
              !newGuest.business_model
              || !newGuest.source
              || (newGuest.source === "Khác" && !newGuest.source_detail.trim())
            }
            className="h-10 rounded-md text-[13px] font-bold border bg-brand text-brand-teal border-brand active:opacity-90 inline-flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <IconPlus className="w-3.5 h-3.5" />
            Thêm
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-text-secondary mb-1">
        {label}
        {required && <span className="text-error ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
