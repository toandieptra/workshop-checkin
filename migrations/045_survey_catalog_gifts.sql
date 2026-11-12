-- PHASE 2: danh mục sản phẩm/công thức dùng chung, khảo sát theo workshop,
-- phiếu trả lời có snapshot phiên bản và quà tặng đổi bằng QR.
-- Chỉ thêm bảng/quyền mới; chạy lại an toàn khi deploy replay migration.

CREATE TABLE IF NOT EXISTS catalog_categories (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_id uuid REFERENCES catalog_categories(id) ON DELETE RESTRICT,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_categories_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT catalog_categories_not_self CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX IF NOT EXISTS ix_catalog_categories_parent ON catalog_categories(parent_id, sort_order);

CREATE TABLE IF NOT EXISTS catalog_products (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id uuid REFERENCES catalog_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  search_key text NOT NULL DEFAULT '',
  short_description text,
  status text NOT NULL DEFAULT 'active',
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_products_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT catalog_products_status_check CHECK (status IN ('active', 'inactive', 'archived'))
);
CREATE INDEX IF NOT EXISTS ix_catalog_products_category ON catalog_products(category_id, sort_order);
CREATE INDEX IF NOT EXISTS ix_catalog_products_status ON catalog_products(status);

CREATE TABLE IF NOT EXISTS catalog_recipes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id uuid REFERENCES catalog_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  search_key text NOT NULL DEFAULT '',
  short_description text,
  instructions text,
  status text NOT NULL DEFAULT 'active',
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_recipes_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT catalog_recipes_status_check CHECK (status IN ('active', 'inactive', 'archived'))
);
CREATE INDEX IF NOT EXISTS ix_catalog_recipes_category ON catalog_recipes(category_id, sort_order);

CREATE TABLE IF NOT EXISTS catalog_recipe_products (
  recipe_id uuid NOT NULL REFERENCES catalog_recipes(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (recipe_id, product_id)
);
CREATE INDEX IF NOT EXISTS ix_catalog_recipe_products_product ON catalog_recipe_products(product_id);

-- Một bảng ảnh cho cả sản phẩm và công thức; ảnh đầu tiên (sort_order nhỏ nhất) là ảnh chính.
CREATE TABLE IF NOT EXISTS catalog_images (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id uuid REFERENCES catalog_products(id) ON DELETE CASCADE,
  recipe_id uuid REFERENCES catalog_recipes(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  thumb_url text NOT NULL,
  width integer,
  height integer,
  alt text,
  focus_y smallint NOT NULL DEFAULT 35,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_images_one_owner CHECK ((product_id IS NULL) <> (recipe_id IS NULL)),
  CONSTRAINT catalog_images_focus_check CHECK (focus_y BETWEEN 0 AND 100)
);
CREATE INDEX IF NOT EXISTS ix_catalog_images_product ON catalog_images(product_id, sort_order) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_catalog_images_recipe ON catalog_images(recipe_id, sort_order) WHERE recipe_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS surveys (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id uuid NOT NULL UNIQUE REFERENCES workshops(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  opens_at timestamptz,
  closes_at timestamptz,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_version_id uuid,
  published_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT surveys_status_check CHECK (status IN ('draft', 'published', 'closed')),
  CONSTRAINT surveys_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 80),
  CONSTRAINT surveys_window_check CHECK (opens_at IS NULL OR closes_at IS NULL OR opens_at < closes_at)
);

CREATE TABLE IF NOT EXISTS survey_groups (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  survey_id uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES survey_groups(id) ON DELETE CASCADE,
  title text NOT NULL,
  short_title text,
  tint text,
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT survey_groups_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 120)
);
CREATE INDEX IF NOT EXISTS ix_survey_groups_survey ON survey_groups(survey_id, parent_id, sort_order);

CREATE TABLE IF NOT EXISTS survey_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  survey_id uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  group_id uuid REFERENCES survey_groups(id) ON DELETE SET NULL,
  item_type text NOT NULL,
  product_id uuid REFERENCES catalog_products(id) ON DELETE RESTRICT,
  recipe_id uuid REFERENCES catalog_recipes(id) ON DELETE RESTRICT,
  display_name text,
  image_override_url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT survey_items_type_check CHECK (
    (item_type = 'product' AND product_id IS NOT NULL AND recipe_id IS NULL)
    OR (item_type = 'recipe' AND recipe_id IS NOT NULL AND product_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_survey_items_product ON survey_items(survey_id, product_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_survey_items_recipe ON survey_items(survey_id, recipe_id) WHERE recipe_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_survey_items_survey ON survey_items(survey_id, group_id, sort_order);

CREATE TABLE IF NOT EXISTS survey_versions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  survey_id uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  snapshot jsonb NOT NULL,
  published_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (survey_id, version_no)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'surveys_current_version_fk') THEN
    ALTER TABLE surveys ADD CONSTRAINT surveys_current_version_fk
      FOREIGN KEY (current_version_id) REFERENCES survey_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Phiên trả lời công khai: chỉ lưu hash của session token.
CREATE TABLE IF NOT EXISTS survey_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  survey_id uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  version_id uuid REFERENCES survey_versions(id) ON DELETE SET NULL,
  token_hash text NOT NULL UNIQUE,
  full_name text NOT NULL,
  phone text NOT NULL,
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  draft_revision integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  CONSTRAINT survey_sessions_status_check CHECK (status IN ('draft', 'submitted'))
);
CREATE INDEX IF NOT EXISTS ix_survey_sessions_survey ON survey_sessions(survey_id, status);

CREATE TABLE IF NOT EXISTS survey_responses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  survey_id uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  workshop_id uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES survey_versions(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL UNIQUE REFERENCES survey_sessions(id) ON DELETE CASCADE,
  guest_id uuid REFERENCES guests(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  phone text NOT NULL,
  rating smallint,
  adjectives jsonb NOT NULL DEFAULT '[]'::jsonb,
  custom_adjectives jsonb NOT NULL DEFAULT '[]'::jsonb,
  discomfort text,
  expectation text,
  favorite_count integer NOT NULL DEFAULT 0,
  is_valid boolean NOT NULL DEFAULT true,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT survey_responses_rating_check CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
);
CREATE INDEX IF NOT EXISTS ix_survey_responses_survey ON survey_responses(survey_id, submitted_at DESC);
-- Một SĐT gửi tối đa số phiếu bằng số khách đã check-in (kiểm tra trong giao dịch có advisory lock).
CREATE INDEX IF NOT EXISTS ix_survey_responses_phone ON survey_responses(survey_id, phone);

CREATE TABLE IF NOT EXISTS survey_response_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  response_id uuid NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  item_type text NOT NULL,
  source_id uuid NOT NULL,
  name_snapshot text NOT NULL,
  group_snapshot text,
  favorited boolean NOT NULL DEFAULT false,
  note_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  note_text text,
  CONSTRAINT survey_response_items_type_check CHECK (item_type IN ('product', 'recipe')),
  UNIQUE (response_id, item_key)
);
CREATE INDEX IF NOT EXISTS ix_survey_response_items_source ON survey_response_items(item_type, source_id);

CREATE TABLE IF NOT EXISTS gift_configs (
  workshop_id uuid PRIMARY KEY REFERENCES workshops(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  gift_name text NOT NULL DEFAULT '',
  description text,
  instructions text,
  eligibility text NOT NULL DEFAULT 'registered',
  redeem_until timestamptz,
  updated_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gift_configs_eligibility_check CHECK (eligibility IN ('registered', 'confirmed', 'checked_in'))
);

CREATE TABLE IF NOT EXISTS gift_claims (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  survey_id uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  response_id uuid NOT NULL UNIQUE REFERENCES survey_responses(id) ON DELETE CASCADE,
  guest_id uuid REFERENCES guests(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'issued',
  token_hash text NOT NULL UNIQUE,
  short_code_hash text NOT NULL,
  gift_name_snapshot text NOT NULL DEFAULT '',
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  revoke_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gift_claims_status_check CHECK (status IN ('eligible', 'issued', 'redeemed', 'expired', 'revoked')),
  CONSTRAINT gift_claims_redeemed_check CHECK (status <> 'redeemed' OR redeemed_at IS NOT NULL)
);
-- Mã nhập tay là duy nhất toàn hệ thống để nhận ra mã của workshop khác.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_claims_short_code_global ON gift_claims(short_code_hash);
-- Mỗi phiếu hoàn thành = 1 mã quà; một đăng ký có thể có nhiều quà (tối đa số khách đã check-in).
CREATE INDEX IF NOT EXISTS ix_gift_claims_guest ON gift_claims(workshop_id, guest_id);
CREATE INDEX IF NOT EXISTS ix_gift_claims_workshop ON gift_claims(workshop_id, status);

CREATE TABLE IF NOT EXISTS gift_audit_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id uuid REFERENCES workshops(id) ON DELETE CASCADE,
  claim_id uuid REFERENCES gift_claims(id) ON DELETE SET NULL,
  action text NOT NULL,
  result text NOT NULL,
  actor_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_gift_audit_logs_workshop ON gift_audit_logs(workshop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_gift_audit_logs_claim ON gift_audit_logs(claim_id, created_at DESC);

-- Quyền mới cho role dựng sẵn: chỉ cấp một lần (marker) để deploy replay không
-- cấp lại quyền mà quản trị viên đã chủ động gỡ.
CREATE TABLE IF NOT EXISTS app_migration_markers (
  key text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_migration_markers WHERE key = '045_survey_permissions') THEN
    UPDATE role_permissions SET permissions = permissions || '["catalog.read"]'::jsonb
    WHERE role IN ('viewer', 'editor', 'admin', 'super_admin') AND NOT (permissions ? 'catalog.read');
    UPDATE role_permissions SET permissions = permissions || '["surveys.read"]'::jsonb
    WHERE role IN ('viewer', 'editor', 'admin', 'super_admin') AND NOT (permissions ? 'surveys.read');
    UPDATE role_permissions SET permissions = permissions || '["surveys.manage"]'::jsonb
    WHERE role IN ('editor', 'admin', 'super_admin') AND NOT (permissions ? 'surveys.manage');
    UPDATE role_permissions SET permissions = permissions || '["gifts.redeem"]'::jsonb
    WHERE role IN ('editor', 'admin', 'super_admin') AND NOT (permissions ? 'gifts.redeem');
    UPDATE role_permissions SET permissions = permissions || '["catalog.manage"]'::jsonb
    WHERE role IN ('admin', 'super_admin') AND NOT (permissions ? 'catalog.manage');
    UPDATE role_permissions SET permissions = permissions || '["gifts.manage"]'::jsonb
    WHERE role IN ('admin', 'super_admin') AND NOT (permissions ? 'gifts.manage');
    INSERT INTO app_migration_markers (key) VALUES ('045_survey_permissions');
  END IF;
END $$;
