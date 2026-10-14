export type ZbsTemplateStatus = "PENDING_REVIEW" | "ENABLE" | "REJECT" | "DISABLE" | "DELETE";
export type ZbsTemplateQuality = "HIGH" | "MEDIUM" | "LOW" | "UNDEFINED";
export type ZbsTemplateType = 1 | 2 | 3 | 4 | 5;
export type ZbsTaskKey = "registration_confirmation" | "checkin_confirmation";

export interface ZbsTemplateListItem {
  template_id: string;
  template_name: string;
  status: ZbsTemplateStatus;
  quality: ZbsTemplateQuality | null;
  tag: string | null;
  template_type: ZbsTemplateType | null;
  preview_url: string | null;
  price_sdt: string | null;
  price_uid: string | null;
  zalo_created_at: string | null;
  synced_at: string;
  hidden: boolean;
}

export interface ZbsTemplateParameter {
  name: string;
  require: boolean;
  type: string;
  maxLength: number;
  minLength: number;
  acceptNull: boolean;
}

export interface ZbsTemplateButton {
  type: number;
  title: string;
  content: string;
}

export interface ZbsTemplateDetail extends ZbsTemplateListItem {
  detail: {
    reason?: string;
    listParams?: ZbsTemplateParameter[];
    listButtons?: ZbsTemplateButton[];
    timeout?: number;
    [key: string]: unknown;
  };
}

export interface ZbsTemplateListResponse {
  data: ZbsTemplateListItem[];
  metadata: {
    total: number;
    offset: number;
    limit: number;
    last_synced_at: string | null;
    hidden_count: number;
  };
}

export interface ZbsTaskConfig {
  task_key: ZbsTaskKey;
  task_label: string;
  enabled: boolean;
  template_id: string | null;
  template_name: string | null;
  template_status: ZbsTemplateStatus | null;
  updated_at: string;
  system_enabled: boolean;
}

export interface ZbsSyncResult {
  synced: number;
  created: number;
  updated: number;
  message: string;
}

export type ZbsOAuthStatus = "connected" | "expiring" | "refresh_failed" | "reauthorization_required" | "not_configured";

export interface ZbsOAuthStatusResponse {
  status: ZbsOAuthStatus;
  configured: boolean;
  access_token_expires_at: string | null;
  last_refreshed_at: string | null;
  last_refresh_error: string | null;
}

export type ZbsDeliveryStatus = "pending" | "sending" | "sent" | "delivered" | "failed" | "expired" | "cancelled";

export interface ZbsParamSource {
  key: string;
  label: string;
}

export interface ZbsBulkOptions {
  sources: ZbsParamSource[];
  default_sources: Record<string, string>;
  system_enabled: boolean;
}

export interface ZbsParamMapping {
  source: string;
  value: string;
}

export interface ZbsBulkRequest {
  template_id: string;
  workshop_id: string;
  guest_ids: string[];
  params: Record<string, ZbsParamMapping>;
  allow_resend: boolean;
}

export interface ZbsBulkRecipient {
  guest_id: string;
  full_name: string;
  phone: string | null;
  eligible: boolean;
  reason: string | null;
  template_data: Record<string, string | number>;
}

export interface ZbsBulkPreflight {
  total: number;
  eligible_count: number;
  ineligible_count: number;
  eligible_guest_ids: string[];
  mapping_errors: string[];
  system_enabled: boolean;
  price_per_message: number | null;
  estimated_cost: number | null;
  can_send: boolean;
  recipients: ZbsBulkRecipient[];
}

export interface ZbsBulkDeliveryItem {
  id: string;
  guest_id: string;
  full_name: string | null;
  status: ZbsDeliveryStatus;
  phone: string | null;
  attempt_count: number;
  last_error: string | null;
  sent_time: string | null;
  delivery_time: string | null;
  updated_at: string;
}

export interface ZbsBulkBatch {
  bulk_id: string;
  template_id: string | null;
  template_name: string | null;
  workshop_id: string;
  workshop_name: string | null;
  created_at: string;
  created_by_name: string | null;
  total: number;
  counts: Record<ZbsDeliveryStatus, number>;
  items?: ZbsBulkDeliveryItem[];
  skipped?: Array<{ guest_id: string; full_name: string; reason: string | null }>;
}

export interface ZbsGuestBulkStatus {
  status: ZbsDeliveryStatus;
  last_error: string | null;
  sent_time: string | null;
  bulk_id: string | null;
}
