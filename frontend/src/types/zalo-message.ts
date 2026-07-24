export type ZaloMessageBlockType = "text" | "image" | "video";
export type ZaloMessageTemplateStatus = "draft" | "active" | "archived";

export interface ZaloMessageImage {
  id: string;
  url: string;
}

export interface ZaloMessageBlock {
  id: string;
  type: ZaloMessageBlockType;
  text?: string;
  images?: ZaloMessageImage[];
  /** Legacy single-image templates may still expose url. */
  url?: string;
  thumbnail_url?: string;
}

export interface ZaloTemplateVariable {
  key: string;
  label: string;
  group: "Guest" | "Workshop";
  description?: string;
}

export interface ZaloMessageTemplate {
  id: string;
  name: string;
  description?: string | null;
  status: ZaloMessageTemplateStatus;
  blocks: ZaloMessageBlock[];
  created_at: string;
  updated_at: string;
}

export interface ZaloMessageTemplateListResponse {
  data: ZaloMessageTemplate[];
  metadata: { total: number; offset: number; limit: number };
}

export interface ZaloMessageTemplateInput {
  name: string;
  description?: string;
  status: ZaloMessageTemplateStatus;
  blocks: Array<Omit<ZaloMessageBlock, "id"> & { id?: string }>;
}

export interface ZaloMessageQuota {
  used: number;
  limit: number;
  remaining: number;
  resets_at: string | null;
}

export interface ZaloBulkGuest {
  guest_id: string;
  full_name: string;
  phone?: string | null;
  eligible: boolean;
  reason?: string | null;
}

export interface ZaloBulkPreflight {
  template_id: string;
  total: number;
  eligible_count: number;
  ineligible_count: number;
  quota_remaining: number;
  can_send: boolean;
}

export interface ZaloBulkSendResult {
  batch_id: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  results?: Array<{
    guest_id: string;
    full_name?: string;
    status: "pending" | "sending" | "sent" | "failed" | "skipped";
    error?: string | null;
  }>;
}

export interface ZaloMediaUploadResult {
  url: string;
  thumbnail_url?: string | null;
}

export interface ZaloDeliveryItem {
  id: string;
  delivery_id: string;
  guest_id?: string | null;
  recipient_id?: string | null;
  recipient_name?: string | null;
  phone?: string | null;
  block_position?: number;
  block_payload?: Record<string, unknown>;
  quota_cost?: number;
  status: string;
  attempt_count: number;
  message_ids: string[];
  last_error?: string | null;
  sent_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ZaloDelivery {
  id: string;
  batch_id?: string | null;
  template_id?: string | null;
  template_name: string;
  content_blocks: Array<Record<string, unknown>>;
  status: string;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  items: ZaloDeliveryItem[];
  created_by?: string | null;
}
