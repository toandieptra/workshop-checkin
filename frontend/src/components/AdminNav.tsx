"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useOutsidePointerDown } from "@/hooks/useOutsidePointerDown";
import { useAuth, type AuthUser } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";
import { roleLabel } from "@/lib/roles";

const ITEMS = [
  { href: "/admin", label: "Khách mời", permission: PERMISSIONS.guestsView },
  { href: "/admin/workshop", label: "Workshop", permission: PERMISSIONS.workshopsView },
  { href: "/admin/forms", label: "Form đăng ký", permission: PERMISSIONS.formsView },
  { href: "/admin/thong-ke", label: "Thống kê", permission: PERMISSIONS.reportsView },
];

function userDisplayName(user: AuthUser | null): string {
  return (user?.name || user?.display_name || user?.email || (user?.username as string | undefined) || "Tài khoản").trim();
}

function userSubtitle(user: AuthUser | null): string {
  if (!user) return "";
  if (user.account_type === "checkin_guest") return `Khách check-in · ${(user.username as string | undefined) || ""}`.trim();
  return [user.email, user.role ? roleLabel(user.role) : ""].filter(Boolean).join(" · ");
}

function UserAvatar({ user, size = "sm" }: { user: AuthUser | null; size?: "sm" | "md" }) {
  const [broken, setBroken] = useState(false);
  const dimension = size === "md" ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs";
  const name = userDisplayName(user);
  const words = name.split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.slice(0, 2)).toLocaleUpperCase("vi");
  if (user?.avatar_url && !broken) {
    // eslint-disable-next-line @next/next/no-img-element -- ảnh đại diện từ Lark, không qua tối ưu ảnh của Next.
    return <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={`${dimension} shrink-0 rounded-full object-cover ring-1 ring-line`} />;
  }
  return <span aria-hidden className={`${dimension} grid shrink-0 place-items-center rounded-full bg-brand/15 font-bold text-brand-teal`}>{initials}</span>;
}

/** Tên + avatar người đăng nhập; bấm mở menu chứa thông tin tài khoản và nút đăng xuất. */
function UserMenu() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useOutsidePointerDown(ref, useCallback(() => setOpen(false), []), open);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const name = userDisplayName(user);

  return (
    <div ref={ref} className="relative ml-2">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Tài khoản ${name}`}
        className={`flex min-h-10 items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition ${open ? "bg-surface-muted" : "hover:bg-surface-muted"}`}
      >
        <UserAvatar user={user} />
        <span className="max-w-[10rem] truncate text-sm font-semibold text-brand-teal">{name}</span>
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div role="menu" aria-label="Tài khoản" className="absolute right-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <UserAvatar user={user} size="md" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">{name}</div>
              <div className="truncate text-xs text-muted">{userSubtitle(user)}</div>
            </div>
          </div>
          <div className="p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); void logout(); }}
              className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="m10 17-5-5 5-5" /><path d="M5 12h12" /></svg>
              Đăng xuất
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminNav() {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, can, canInAnyWorkshop, logout } = useAuth();
  const items = [
    ...ITEMS.filter((item) => canInAnyWorkshop(item.permission) || (item.permission === PERMISSIONS.workshopsView && can(PERMISSIONS.workshopsCreate))),
    ...(can(PERMISSIONS.usersView) || can(PERMISSIONS.connectionsView) || can(PERMISSIONS.zbsView) || can(PERMISSIONS.zaloTemplatesView)
      ? [{ href: "/admin/cai-dat", label: "Cài đặt", permission: PERMISSIONS.connectionsView }]
      : []),
  ];

  // Đóng drawer khi đổi route.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menuOpen]);

  if (pathname === "/admin/login") return null;

  const isMobileReady = isMobile === true;

  return (
    <header className="sticky top-0 z-20 bg-surface border-b border-line">
      <div className="h-14 w-full px-4 sm:px-6 flex items-center justify-between">
        <Link href="/admin" className="block leading-none">
          <div className="text-brand text-[10px] font-semibold tracking-widest leading-none">HI SWEETIE VIỆT NAM</div>
          <div className="text-brand-teal font-bold text-sm leading-tight">Workshop Check-in</div>
        </Link>

        {isMobileReady ? (
          <button
            aria-label={menuOpen ? "Đóng menu" : "Mở menu"}
            aria-expanded={menuOpen}
            aria-controls="admin-mobile-navigation"
            onClick={() => setMenuOpen((v) => !v)}
            className="grid h-11 w-11 -mr-2 place-items-center text-brand-teal rounded-md active:bg-surface-muted"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {menuOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
        ) : (
          <nav className="flex items-center gap-1">
            {items.map((it) => {
              const active = pathname === it.href || (it.href !== "/admin" && pathname.startsWith(it.href));
              return (
                <Link key={it.href} href={it.href}
                  className={`px-4 py-1.5 rounded-sm text-sm font-medium transition ${
                    active ? "bg-brand text-brand-teal" : "text-muted hover:text-brand-teal"
                  }`}>
                  {it.label}
                </Link>
              );
            })}
            <UserMenu />
          </nav>
        )}
      </div>

      {/* Mobile drawer — nav dọc. */}
      {isMobileReady && menuOpen && (
        <>
          <div
            className="fixed inset-0 top-14 z-10 bg-black/30"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <nav id="admin-mobile-navigation" aria-label="Điều hướng quản trị" className="fixed inset-x-0 top-14 z-20 bg-surface border-b border-line shadow-md">
            <div className="flex items-center gap-3 border-b border-line px-6 py-3">
              <UserAvatar user={user} size="md" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">{userDisplayName(user)}</div>
                <div className="truncate text-xs text-muted">{userSubtitle(user)}</div>
              </div>
            </div>
            <ul className="px-3 py-2 flex flex-col">
              {items.map((it) => {
                const active = pathname === it.href || (it.href !== "/admin" && pathname.startsWith(it.href));
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      className={`block px-3 rounded-md text-sm font-medium min-h-[44px] flex items-center ${
                        active ? "bg-brand text-brand-teal" : "text-brand-teal active:bg-surface-muted"
                      }`}
                    >
                      {it.label}
                    </Link>
                  </li>
                );
              })}
              <li className="border-t border-line mt-1 pt-1">
                <button
                   onClick={() => void logout()}
                  className="w-full text-left px-3 rounded-md text-sm font-medium text-red-600 min-h-[44px] flex items-center"
                >
                  Đăng xuất
                </button>
              </li>
            </ul>
          </nav>
        </>
      )}
    </header>
  );
}
