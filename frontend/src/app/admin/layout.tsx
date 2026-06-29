import AdminNav from "@/components/AdminNav";
import AdminGate from "@/components/AdminGate";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGate>
      <div className="min-h-screen bg-surface-muted">
        <AdminNav />
        <main>{children}</main>
      </div>
    </AdminGate>
  );
}
