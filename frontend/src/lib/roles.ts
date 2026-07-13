/**
 * Role catalog shared by user management and role-permission administration.
 * The values are persisted role keys; labels are intentionally Vietnamese for UI.
 */
export const ROLE_ORDER = ["user", "viewer", "editor", "admin", "super_admin"] as const;

export type RoleKey = (typeof ROLE_ORDER)[number];

export const ROLE_META: Record<RoleKey, { label: string; description: string }> = {
  user: { label: "Người dùng", description: "Vai trò mặc định, không có quyền quản trị" },
  viewer: { label: "Người xem", description: "Chỉ xem dữ liệu workshop" },
  editor: { label: "Biên tập viên", description: "Quản lý nội dung và check-in" },
  admin: { label: "Quản trị viên", description: "Quản trị hệ thống, trừ phân quyền" },
  super_admin: { label: "Quản trị cấp cao", description: "Toàn quyền hệ thống" },
};

/** Displays a safe label even when data from an older system has an unknown role. */
export function roleLabel(role: string): string {
  return ROLE_META[role as RoleKey]?.label || role;
}
