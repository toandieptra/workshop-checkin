import AdminNav from "@/components/AdminNav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-muted">
      <AdminNav />
      <main>{children}</main>
    </div>
  );
}
