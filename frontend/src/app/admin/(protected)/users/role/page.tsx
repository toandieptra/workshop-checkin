import { redirect } from "next/navigation";

export default function RolePermissionsPage() {
  redirect("/admin/cai-dat?tab=phan-quyen");
}
