"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminLogout } from "@/components/AdminGate";
import CreateRegistrationFormModal from "@/components/CreateRegistrationFormModal";
import { useIsMobile } from "@/hooks/useIsMobile";

const ITEMS = [
  { href: "/admin", label: "Khách mời" },
  { href: "/admin/forms", label: "Form đăng ký" },
  { href: "/admin/thong-ke", label: "Thống kê" },
];

export default function AdminNav() {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Đóng drawer khi đổi route.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

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
            {ITEMS.map((it) => {
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
            <button
              onClick={() => setFormModalOpen(true)}
              className="ml-2 border border-brand text-brand px-4 py-1.5 rounded-sm text-sm font-medium hover:bg-brand/5 transition">
              + Tạo Form Đăng Ký
            </button>
            <button
              onClick={adminLogout}
              className="ml-1 px-4 py-1.5 rounded-sm text-sm font-medium text-muted hover:text-red-600 transition">
              Đăng xuất
            </button>
          </nav>
        )}
      </div>

      {/* Mobile drawer — nav dọc, ẩn "Tạo Form Đăng Ký" (tác vụ nặng, để desktop). */}
      {isMobileReady && menuOpen && (
        <>
          <div
            className="fixed inset-0 top-14 z-10 bg-black/30"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <nav className="fixed inset-x-0 top-14 z-20 bg-surface border-b border-line shadow-md">
            <ul className="px-3 py-2 flex flex-col">
              {ITEMS.map((it) => {
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
              <li className="border-t border-line mt-1 pt-1">
                <button
                  onClick={adminLogout}
                  className="w-full text-left px-3 rounded-md text-sm font-medium text-red-600 min-h-[44px] flex items-center"
                >
                  Đăng xuất
                </button>
              </li>
            </ul>
          </nav>
        </>
      )}

      <CreateRegistrationFormModal open={formModalOpen} onClose={() => setFormModalOpen(false)} />
    </header>
  );
}
