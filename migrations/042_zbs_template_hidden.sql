-- Mẫu tin ẩn không hiển thị trong danh sách mặc định và không dùng được để gửi.
-- Zalo không trả về ứng dụng sở hữu mẫu tin, nên mẫu của ứng dụng khác (CNV CDP)
-- được ẩn theo mã. Deploy có thể chạy lại file này: chỉ ẩn sẵn khi cột mới được tạo,
-- để không ghi đè lựa chọn "Bỏ ẩn" của quản trị viên.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'zbs_templates' AND column_name = 'hidden'
    ) THEN
        ALTER TABLE zbs_templates ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT false;
        UPDATE zbs_templates SET hidden = true
        WHERE template_id IN (
            '374507', '374508', '374509', '374511', '374512', '374514', '374516',
            '374519', '374520', '374521', '374523', '374525', '374527', '374530', '374533'
        );
    END IF;
END $$;
