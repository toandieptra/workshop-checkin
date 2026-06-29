"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminLogout } from "@/components/AdminGate";

const ITEMS = [
  { href: "/admin", label: "Khách mời" },
  { href: "/admin/thong-ke", label: "Thống kê" },
];

export default function AdminNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 bg-surface border-b border-line">
      <div className="max-w-6xl mx-auto h-14 px-6 flex items-center justify-between">
        <div>
          <div className="text-brand text-[10px] font-semibold tracking-widest leading-none">HI SWEETIE VIỆT NAM</div>
          <div className="text-brand-teal font-bold text-sm leading-tight">Workshop Check-in</div>
        </div>
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
            onClick={adminLogout}
            className="ml-2 px-4 py-1.5 rounded-sm text-sm font-medium text-muted hover:text-red-600 transition">
            Đăng xuất
          </button>
        </nav>
      </div>
    </header>
  );
}
