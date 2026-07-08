import AdminGate from "@/components/AdminGate";

/**
 * Layout cho segment /admin (UI cần auth).
 * - /admin, /admin/forms, /admin/thong-ke → bọc AdminGate.
 * - /admin/login → render theo layout cha (`admin/layout.tsx`) vì đứng ngoài group (protected).
 */
export default function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}