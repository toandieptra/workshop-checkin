-- Custom roles use the same persisted permission catalog as built-in roles.
ALTER TABLE role_permissions
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS description text;

UPDATE role_permissions SET
  label = CASE role
    WHEN 'user' THEN 'Người dùng'
    WHEN 'viewer' THEN 'Người xem'
    WHEN 'editor' THEN 'Biên tập viên'
    WHEN 'admin' THEN 'Quản trị viên'
    WHEN 'super_admin' THEN 'Quản trị cấp cao'
  END,
  description = CASE role
    WHEN 'user' THEN 'Vai trò mặc định, không có quyền quản trị'
    WHEN 'viewer' THEN 'Chỉ xem dữ liệu workshop'
    WHEN 'editor' THEN 'Quản lý nội dung và check-in'
    WHEN 'admin' THEN 'Quản trị hệ thống, trừ phân quyền'
    WHEN 'super_admin' THEN 'Toàn quyền hệ thống'
  END
WHERE role IN ('user', 'viewer', 'editor', 'admin', 'super_admin');

-- Preserve any roles that may have been created before this migration.
UPDATE role_permissions
SET label = role
WHERE label IS NULL;

ALTER TABLE role_permissions
  ALTER COLUMN label SET NOT NULL;
