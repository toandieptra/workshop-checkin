"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";

const ITEMS = [
  { href: "/admin", label: "Khách mời", permission: PERMISSIONS.guestsView },
  { href: "/admin/workshop", label: "Workshop", permission: PERMISSIONS.workshopsView },
  { href: "/admin/forms", label: "Form đăng ký", permission: PERMISSIONS.formsView },
  { href: "/admin/thong-ke", label: "Thống kê", permission: PERMISSIONS.reportsView },
  { href: "/admin/zbs-template", label: "Mẫu tin ZBS", permission: PERMISSIONS.zbsView },
];

const USER_ITEMS = [
  { href: "/admin/users", label: "Danh sách người dùng" },
  { href: "/admin/users/role", label: "Phân quyền vai trò" },
];

export default function AdminNav() {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { can, logout } = useAuth();
  const items = ITEMS.filter((item) => can(item.permission));

  // Đóng drawer khi đổi route.
  useEffect(() => {
    setMenuOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  if (pathname === "/admin/login") return null;

  const isMobileReady = isMobile === true;

  return (
    <header className="sticky top-0 z-20 bg-surface border-b border-line">
      <div className="max-w-6xl mx-auto h-14 px-4 sm:px-6 flex items-center justify-between">
        <Link href="/admin" className="block leading-none">
          <div className="text-brand text-[10px] font-semibold tracking-widest leading-none">HI SWEETIE VIỆT NAM</div>
          <div className="text-brand-teal font-bold text-sm leading-tight">Workshop Check-in</div>
        </Link>

        {isMobileReady ? (
          <button
            aria-label={menuOpen ? "Đóng menu" : "Mở menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="p-2 -mr-2 text-brand-teal rounded-md active:bg-surface-muted"
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
              const active = pathname === it.href;
              return (
                <Link key={it.href} href={it.href}
                  className={`px-4 py-1.5 rounded-sm text-sm font-medium transition ${
                    active ? "bg-brand text-white" : "text-muted hover:text-brand"
                  }`}>
                  {it.label}
                </Link>
              );
            })}
            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                aria-expanded={userMenuOpen}
                onClick={() => setUserMenuOpen((open) => !open)}
                className={`px-4 py-1.5 rounded-sm text-sm font-medium transition flex items-center gap-1.5 ${
                  pathname.startsWith("/admin/users") ? "bg-brand text-white" : "text-muted hover:text-brand"
                }`}
              >
                Người dùng
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-52 rounded-md border border-line bg-white p-1.5 shadow-lg">
                  {can(PERMISSIONS.usersView) && (
                    <>
                     {USER_ITEMS.map((item) => (
                       <Link
                        key={item.href}
                        href={item.href}
                        className={`block rounded px-3 py-2 text-sm ${pathname === item.href ? "bg-surface-muted text-brand-teal font-semibold" : "text-text-secondary hover:bg-surface-muted"}`}
                      >
                         {item.label}
                       </Link>
                     ))}
                      <div className="my-1 border-t border-line" />
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      void logout();
                    }}
                    className="w-full rounded px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    Đăng xuất
                  </button>
                </div>
              )}
            </div>
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
          <nav className="fixed inset-x-0 top-14 z-20 bg-surface border-b border-line shadow-md">
            <ul className="px-3 py-2 flex flex-col">
              {items.map((it) => {
                const active = pathname === it.href;
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
              {can(PERMISSIONS.usersView) && (
                <li className="border-t border-line mt-1 pt-1">
                  <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Người dùng</div>
                  {USER_ITEMS.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`block px-3 rounded-md text-sm font-medium min-h-[44px] flex items-center ${
                        pathname === item.href ? "bg-brand text-white" : "text-brand-teal active:bg-surface-muted"
                      }`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </li>
              )}
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
