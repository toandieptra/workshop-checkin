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
