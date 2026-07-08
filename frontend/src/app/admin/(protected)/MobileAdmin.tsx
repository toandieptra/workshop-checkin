"use client";
import { useState } from "react";
import QrDisplay from "@/components/QrDisplay";
import { useAdminGuests, type Guest } from "@/hooks/useAdminGuests";

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
    doUncheckin,
    toggleVip,
    copyPhone,
    msg,
    setMsg,
  } = useAdminGuests();

  const [linkCopied, setLinkCopied] = useState(false);

  const welcomeUrl =
    typeof window !== "undefined" && currentWorkshop
      ? `${window.location.origin}/welcome?w=${currentWorkshop.slug}`
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

  const notCheckedIn = Math.max(0, totalRegistered - totalCheckedIn);
  const { host: welcomeHost, rest: welcomeRest } = splitUrl(welcomeUrl);
  const filterActive = statusFilter !== "all" || search.trim().length > 0;

  return (
    <div className="pb-20">
      {/* ======= 1. Sticky header — workshop picker + 4 KPI cards ======= */}
      <section className="sticky top-14 z-10 bg-surface border-b border-line">
        <div className="px-3 pt-3 pb-2.5 flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <IconChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
            <select
              className="w-full appearance-none border border-line rounded-md pl-3 pr-8 py-2 text-sm bg-surface text-brand-teal font-semibold focus:border-brand focus:ring-2 focus:ring-brand/20"
              value={wid}
              onChange={(e) => setWid(e.target.value)}
            >
              {workshops.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          {currentWorkshop && (
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-success shrink-0"
              aria-label="Workshop đang diễn ra"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse-live" />
              Live
            </span>
          )}
        </div>

        <div className="grid grid-cols-4 gap-1.5 px-3 pb-3">
          <KpiCard label="Khách ĐK" value={totalRegistered} tone="default" />
          <KpiCard label="Phiếu" value={totalRecords} tone="default" />
          <KpiCard label="Check-in" value={totalCheckedIn} tone="success" />
          <KpiCard label="Phiếu đã" value={checkedInRecords} tone="success" />
        </div>
      </section>

      {/* ======= 2. Toast — có icon + animation slide-in ======= */}
      {msg && (
        <div
          role="status"
          aria-live="polite"
          className="mx-3 mt-2 flex items-center gap-2 p-2.5 rounded-md text-sm bg-success-soft border border-success-border text-brand-teal animate-toast-in"
        >
          <span className="w-5 h-5 rounded-full bg-success text-white inline-flex items-center justify-center shrink-0">
            <IconCheck className="w-3 h-3" />
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

      {/* ======= 3. QR + Link cards ======= */}
      {currentWorkshop && (
        <section className="grid grid-cols-2 gap-3 px-3 mt-3">
          <div className="bg-surface border border-line rounded-md p-3 flex flex-col items-center shadow-sm">
            <PanelLabel icon={<IconQrCode className="w-3 h-3" />}>QR Check-in</PanelLabel>
            <div className="flex-1 flex items-center justify-center w-full">
              <QrDisplay workshopSlug={currentWorkshop.slug} size={108} showUrl={false} />
            </div>
          </div>
          <div className="bg-surface border-2 border-error rounded-md p-3 flex flex-col shadow-sm">
            <PanelLabel icon={<IconLink className="w-3 h-3" />} className="text-error">
              Link Welcome
            </PanelLabel>
            <div
              className="font-mono text-[10px] leading-[1.35] rounded-md bg-surface-muted px-2 py-1.5 my-2 break-all flex-1 min-h-[40px] flex items-center"
              title={welcomeUrl}
            >
              {welcomeUrl ? (
                <>
                  <span className="text-brand font-medium">{welcomeHost}</span>
                  <span className="text-text-secondary">{welcomeRest}</span>
                </>
              ) : (
                <span className="text-muted">—</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5 mt-auto">
              <button
                onClick={copyWelcomeLink}
                className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-sm text-[11px] font-semibold border border-line bg-surface-muted text-brand-teal active:bg-cyan-pale"
              >
                <IconCopy className="w-3 h-3" />
                {linkCopied ? "Đã copy" : "Sao chép"}
              </button>
              <a
                href={welcomeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-sm text-[11px] font-bold border border-brand bg-brand text-brand-teal active:opacity-90"
              >
                Mở Welcome
                <IconArrowUp className="w-3 h-3 -rotate-90" />
              </a>
            </div>
          </div>
        </section>
      )}

      {/* ======= 4. Search + filter chips + results meta ======= */}
      <section className="px-3 mt-3">
        <div className="relative">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
          <input
            autoFocus
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

        <div className="flex gap-1.5 mt-2 overflow-x-auto">
          <FilterChip
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
            tone="default"
            count={totalRegistered}
          >
            Tất cả
          </FilterChip>
          <FilterChip
            active={statusFilter === "not_checked_in"}
            onClick={() => setStatusFilter("not_checked_in")}
            tone="warn"
            count={notCheckedIn}
          >
            Chưa check-in
          </FilterChip>
          <FilterChip
            active={statusFilter === "checked_in"}
            onClick={() => setStatusFilter("checked_in")}
            tone="ok"
            count={totalCheckedIn}
          >
            Đã check-in
          </FilterChip>
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
          <div className="py-10 text-center text-muted text-sm bg-surface border border-line rounded-md">
            Không có khách khớp bộ lọc
          </div>
        ) : (
          visibleGuests.map((g) => (
            <GuestCard
              key={g.id}
              g={g}
              onCheckin={() => doCheckin(g)}
              onUncheckin={() => doUncheckin(g)}
              onToggleVip={() => toggleVip(g)}
              onCopyPhone={() => g.phone && copyPhone(g.phone)}
            />
          ))
        )}
      </section>

      {/* ======= 6. Home indicator — iOS-style, mờ ======= */}
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

function CountBadge({ children }: { children: number }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full bg-surface-muted text-text-secondary text-[10px] font-semibold">
      {children}
    </span>
  );
}

function FilterChip({
  active,
  onClick,
  tone = "default",
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: "default" | "ok" | "warn";
  count: number;
  children: React.ReactNode;
}) {
  // Tone palette:
  //  - default: cyan primary (brand)
  //  - ok: success teal
  //  - warn: warm amber
  // WCAG: dùng dark text khi active trên nền sáng để đảm bảo ≥4.5:1.
  let cls = "border-line text-muted bg-surface";
  if (active) {
    if (tone === "ok") cls = "border-green-600 bg-green-600 text-white";
    else if (tone === "warn") cls = "border-warning bg-warning text-brand-teal";
    else cls = "border-brand bg-brand text-brand-teal";
  }

  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-semibold border ${cls} active:opacity-80 shrink-0`}
    >
      {children}
      <span
        className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold ${
          active
            ? tone === "ok"
              ? "bg-white/20 text-white"
              : "bg-white/20 text-brand-teal"
            : "bg-surface-muted text-text-secondary"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function GuestCard({
  g,
  onCheckin,
  onUncheckin,
  onToggleVip,
  onCopyPhone,
}: {
  g: Guest;
  onCheckin: () => void;
  onUncheckin: () => void;
  onToggleVip: () => void;
  onCopyPhone: () => void;
}) {
  const vip = isVip(g);
  const checked = g.checkin_status === "checked_in";
  const delta = partyDelta(g);
  const registered = g.party_size || 1;

  return (
    <div
      className={`bg-surface border rounded-md p-3 shadow-sm ${
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
            {g.role_title && (
              <span className="inline-flex items-center h-5 px-1.5 rounded text-[10px] font-semibold bg-surface-muted text-brand-teal">
                {g.role_title}
              </span>
            )}
            <SyncBadge status={g.sync_status} />
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
          {delta ?? registered} khách
        </span>
      </div>

      {/* Row 2: phone chip | meta */}
      <div className="mt-2 flex items-center gap-2 flex-wrap text-[12px]">
        {g.phone ? (
          <button
            onClick={onCopyPhone}
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

      {/* Row 3: CTA + VIP toggle */}
      <div className="mt-3 grid grid-cols-[1fr_40px] gap-2">
        {checked ? (
          <button
            onClick={onUncheckin}
            className="inline-flex items-center justify-center gap-1.5 h-10 rounded-md text-[13px] font-semibold border bg-success-soft text-success border-success-border active:opacity-90"
          >
            <IconCheck className="w-3.5 h-3.5" />
            Đã check-in · {formatHm(g.checked_in_at)}
          </button>
        ) : (
          <button
            onClick={onCheckin}
            className="inline-flex items-center justify-center gap-1.5 h-10 rounded-md text-[13px] font-bold border bg-brand text-brand-teal border-brand active:opacity-90"
          >
            <IconCheck className="w-3.5 h-3.5" />
            Check-in
          </button>
        )}
        <button
          onClick={onToggleVip}
          aria-label={vip ? "Bỏ đánh dấu VIP" : "Đánh dấu VIP"}
          title={vip ? "Bỏ VIP" : "Đánh dấu VIP"}
          className={`inline-flex items-center justify-center h-10 rounded-md border ${
            vip
              ? "bg-brand-gold-soft border-brand-gold text-brand-gold"
              : "border-line text-muted bg-surface"
          }`}
        >
          <IconStar filled={vip} className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
