"use client";
import { useEffect, useState } from "react";
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
];

export default function AdminNav() {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const { can, logout } = useAuth();
  const items = [
    ...ITEMS.filter((item) => can(item.permission)),
    ...(can(PERMISSIONS.usersView) || can(PERMISSIONS.connectionsView) || can(PERMISSIONS.zbsView)
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
      <div className="max-w-6xl mx-auto h-14 px-4 sm:px-6 flex items-center justify-between">
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
            <button type="button" onClick={() => void logout()} className="px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700">Đăng xuất</button>
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
