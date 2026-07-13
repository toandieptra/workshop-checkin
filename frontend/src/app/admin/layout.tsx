import AdminNav from "@/components/AdminNav";
import { AuthProvider } from "@/contexts/AuthContext";

/**
 * Layout chung cho toàn bộ /admin (kể cả /admin/login).
 * - Gate bảo vệ chỉ áp dụng cho các trang trong route group (protected).
 * - Login page đứng ngoài group (protected) nên không bị gate,
 *   vẫn được render trong khung AdminNav + nền chuẩn admin.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-surface-muted">
        <AdminNav />
        <main>{children}</main>
      </div>
    </AuthProvider>
  );
}
