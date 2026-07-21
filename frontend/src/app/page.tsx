import Link from "next/link";

export default function Home() {
  const links = [
    { href: "/welcome", title: "Welcome", desc: "Màn hình chào mừng (Android fullscreen)" },
    { href: "/admin", title: "Admin", desc: "Quản lý workshop, khách, ảnh khuôn mặt" },
    { href: "/admin/thong-ke", title: "Thống kê", desc: "Tổng hợp dữ liệu khách, lọc theo workshop & trạng thái" },
  ];
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-surface-muted">
      <div className="text-center mb-10">
        <div className="text-brand text-sm font-semibold tracking-widest mb-2">HI SWEETIE VIỆT NAM</div>
        <h1 className="text-3xl font-bold text-brand-teal">Workshop Chuyển — Face Check-in</h1>
      </div>
      <div className="grid gap-4 w-full max-w-md">
        {links.map((l) => (
          <Link key={l.href} href={l.href}
            className="block bg-surface rounded-md border border-line p-5 hover:border-brand transition">
            <div className="text-lg font-semibold text-brand-teal">{l.title}</div>
            <div className="text-sm text-muted mt-1">{l.desc}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
