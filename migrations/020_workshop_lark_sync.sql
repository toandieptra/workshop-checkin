-- Push workshop local -> Lark: cần lưu record_id của workshop trên Lark
-- và file_token của mỗi ảnh đã upload lên Lark (chống tạo/đẩy trùng).
ALTER TABLE workshops ADD COLUMN IF NOT EXISTS lark_record_id text;
ALTER TABLE workshop_media ADD COLUMN IF NOT EXISTS lark_file_token text;
