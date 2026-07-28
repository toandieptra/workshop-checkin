import type {
  ZbsSyncResult,
  ZbsTaskConfig,
  ZbsTaskKey,
  ZbsTemplateDetail,
  ZbsTemplateListResponse,
  ZbsTemplateStatus,
  ZbsOAuthStatusResponse,
} from "@/types/zbs-template";
import type {
  ZaloBulkPreflight,
  ZaloBulkSendResult,
  ZaloMediaUploadResult,
  ZaloMessageQuota,
  ZaloMessageTemplate,
  ZaloMessageTemplateInput,
  ZaloMessageTemplateListResponse,
  ZaloMessageTemplateStatus,
  ZaloTemplateVariable,
  ZaloDelivery,
  ZaloDeliveryItem,
  ZaloGuestSendStatus,
} from "@/types/zalo-message";

// Mặc định dùng relative path để tận dụng Next.js rewrite (xem next.config.js).
// Khi dev local nếu muốn trỏ thẳng backend, set NEXT_PUBLIC_API_URL="http://localhost:8427/api".
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || (typeof window !== "undefined"
  ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`
  : "ws://localhost/ws");

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function authHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  return headers;
}

async function throwApiError(res: Response): Promise<never> {
  const text = await res.text().catch(() => "");
  if (typeof window !== "undefined" && res.status === 401 && !location.pathname.startsWith("/admin/login")) {
    location.assign(`/admin/login?redirect=${encodeURIComponent(location.pathname + location.search)}`);
  }
  if (typeof window !== "undefined" && res.status === 403) window.dispatchEvent(new CustomEvent("auth:forbidden"));
  let message = text;
  try {
    const payload = JSON.parse(text);
    message = typeof payload.detail === "string" ? payload.detail : text;
  } catch {
    if (text.trimStart().startsWith("<")) {
      message = "Máy chủ tạm thời không phản hồi. Vui lòng thử lại sau.";
    }
  }
  throw new ApiError(res.status, `${res.status}${message ? ": " + message : ""}`);
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init.body !== null && init.body !== "";
  const headers = authHeaders(init);
  if (hasBody && !headers.has("Content-Type") && !(init?.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) await throwApiError(res);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function apiForm<T = any>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: "POST", body: form, cache: "no-store", credentials: "include", headers: authHeaders({ method: "POST" }) });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

/**
 * Admin identity APIs live under `/api/admin` while business APIs use the
 * configured API base. Normalize both local proxy and absolute API builds.
 */
export async function adminApi<T = any>(path: string, init?: RequestInit): Promise<T> {
  const prefix = API_URL.endsWith("/api") ? `${API_URL}/admin` : "/api/admin";
  const hasBody = init?.body !== undefined && init.body !== null && init.body !== "";
  const headers = authHeaders(init);
  if (hasBody && !headers.has("Content-Type") && !(init?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${prefix}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) await throwApiError(res);
  if (res.status === 204) return undefined as T;
  return res.json();
}

/**
 * Tải file Excel danh sách khách từ backend `/api/export/guests`.
 *
 * - Tự build query (`status`, `workshop_ids`) theo filter của trang gọi.
 * - Tự download blob về máy user (Content-Disposition của backend).
 * - Ném Error nếu backend trả lỗi (để UI hiển thị).
 */
export async function downloadGuestsXlsx(params: {
  workshopIds?: string[];
  status?: "all" | "checked_in" | "not_checked_in";
  filename?: string;
}): Promise<void> {
  const qs = new URLSearchParams();
  qs.set("status", params.status ?? "all");
  if (params.workshopIds && params.workshopIds.length) {
    qs.set("workshop_ids", params.workshopIds.join(","));
  }
  const res = await fetch(`${API_URL}/export/guests?${qs.toString()}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    if (res.status === 401 || res.status === 403) await throwApiError(res);
    throw new ApiError(res.status, `${res.status}${detail ? ": " + detail : ""}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    params.filename ?? `guests_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function maskPhone(phone?: string | null): string {
  if (!phone) return "";
  if (phone.length <= 4) return phone;
  return phone.slice(0, 3) + "****" + phone.slice(-2);
}

// -----------------------------------------------------------------
// Self check-in từ QR chung workshop — dùng cho trang guest
// -----------------------------------------------------------------

export interface LookupResult {
  found: boolean;
  reason?: "ok" | "not_in_workshop" | "wrong_workshop";
  guest?: any;
  workshop_name?: string;
  other_workshop_name?: string;
  other_workshop_slug?: string;
  registered_party_size?: number;
}

export async function lookupByPhone(phone: string, workshopSlug: string): Promise<LookupResult> {
  const params = new URLSearchParams({ phone, workshop_slug: workshopSlug });
  try {
    return await api<LookupResult>("/guests/lookup-by-phone?" + params.toString());
  } catch (e: any) {
    if (e?.message?.includes("404")) {
      return { found: false, reason: "not_in_workshop" };
    }
    throw e;
  }
}

export interface SelfRegisterResult {
  guest: any;
  lark_synced: boolean;
  warning: string | null;
}

export async function selfRegisterAndCheckin(payload: {
  workshop_slug: string;
  full_name: string;
  phone: string;
  actual_party_size: number;
  business_model?: string;
  company?: string;
  email?: string;
}): Promise<SelfRegisterResult> {
  return await api<SelfRegisterResult>("/guests/self-register-and-checkin", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function checkinGuestById(
  id: string,
  actual_party_size?: number,
): Promise<any> {
  return await api(`/guests/${id}/checkin`, {
    method: "POST",
    body: JSON.stringify({ actual_party_size }),
  });
}

export interface GuestQrInfo {
  id: string;
  full_name: string;
  company?: string | null;
  party_size: number;
  actual_party_size?: number | null;
  checkin_status: string;
  checked_in_at?: string | null;
  workshop_id: string;
  workshop_name: string;
  workshop_slug: string;
}

export async function getGuestQrInfo(id: string): Promise<GuestQrInfo> {
  return await api(`/guests/${encodeURIComponent(id)}/qr-info`);
}

export async function selfCheckinGuestById(
  id: string,
  workshopSlug: string,
  phone: string,
  actualPartySize: number,
): Promise<any> {
  return await api(`/guests/${encodeURIComponent(id)}/self-checkin`, {
    method: "POST",
    body: JSON.stringify({
      workshop_slug: workshopSlug,
      phone,
      actual_party_size: actualPartySize,
    }),
  });
}

export async function getWorkshopBySlug(slug: string): Promise<any> {
  return await api("/public/workshops/by-slug/" + encodeURIComponent(slug));
}

export type WorkshopStatus = "draft" | "published" | "completed" | "cancelled";
export type WorkshopMediaType = "banner" | "invitation" | "document";

export interface WorkshopMedia {
  id: string;
  workshop_id: string;
  media_type: WorkshopMediaType | string;
  file_url: string;
  file_name?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  sort_order: number;
  created_at: string;
}

export interface WorkshopLinkedForm {
  id: string;
  token: string;
  greeting?: string | null;
  is_active: boolean;
  submission_count: number;
  created_at: string;
}

export interface WorkshopAdmin {
  id: string;
  name: string;
  slug: string;
  event_date?: string | null;
  event_time?: string | null;
  location?: string | null;
  status: WorkshopStatus | string;
  auto_confirm_registration?: boolean;
  branch?: string | null;
  maps_url?: string | null;
  registration_short_url?: string | null;
  lark_workshop_name?: string | null;
  lark_record_id?: string | null;
  created_at: string;
  updated_at?: string | null;
  last_synced_at?: string | null;
  media: WorkshopMedia[];
  registration_forms: WorkshopLinkedForm[];
}

export interface WorkshopWriteBody {
  name: string;
  slug: string;
  event_date?: string | null;
  event_time?: string | null;
  location?: string | null;
  status?: WorkshopStatus | string;
  auto_confirm_registration: boolean;
  branch?: string | null;
  maps_url?: string | null;
  registration_short_url?: string | null;
  lark_workshop_name?: string | null;
}

export async function getWorkshops(status?: string): Promise<WorkshopAdmin[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return await api("/workshops" + q);
}

export async function getWorkshop(id: string): Promise<WorkshopAdmin> {
  return await api("/workshops/" + id);
}

export async function createWorkshop(body: WorkshopWriteBody): Promise<WorkshopAdmin> {
  return await api("/workshops", { method: "POST", body: JSON.stringify(body) });
}

export async function updateWorkshop(
  id: string,
  body: Partial<WorkshopWriteBody>,
): Promise<WorkshopAdmin> {
  return await api("/workshops/" + id, { method: "PATCH", body: JSON.stringify(body) });
}

export async function updateWorkshopStatus(
  id: string,
  status: WorkshopStatus | string,
): Promise<WorkshopAdmin> {
  return await api("/workshops/" + id + "/status", {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function deleteWorkshop(id: string): Promise<WorkshopAdmin> {
  return await api("/workshops/" + id, { method: "DELETE" });
}

/** Xóa hẳn workshop (hard delete). */
export async function hardDeleteWorkshop(id: string): Promise<void> {
  await api("/workshops/" + id + "?hard=true", { method: "DELETE" });
}

/** Đẩy 1 workshop local lên Lark config table (thủ công / backup). */
export async function pushWorkshopToLark(
  id: string,
): Promise<{ workshop_id: string; lark_record_id: string | null; pushed: boolean }> {
  return await api("/lark/sync/push-workshop/" + id, { method: "POST" });
}

export async function getWorkshopBranches(): Promise<string[]> {
  const res = await api<{ branches: string[] }>("/workshops/meta/branches");
  return res.branches || [];
}

export async function uploadWorkshopMedia(
  workshopId: string,
  files: File[],
  mediaType: WorkshopMediaType | string = "banner",
): Promise<WorkshopMedia[]> {
  const form = new FormData();
  form.append("media_type", mediaType);
  for (const f of files) form.append("files", f);
  return await apiForm("/workshops/" + workshopId + "/media", form);
}

export async function deleteWorkshopMedia(workshopId: string, mediaId: string): Promise<void> {
  await api("/workshops/" + workshopId + "/media/" + mediaId, { method: "DELETE" });
}

// -----------------------------------------------------------------
// Registration forms (Form đăng ký workshop)
// -----------------------------------------------------------------

export interface RegistrationWorkshopOption {
  id: string;
  name: string;
  event_date?: string | null;
  location?: string | null;
  auto_confirm_registration: boolean;
}

export interface RegistrationForm {
  id: string;
  token: string;
  workshop_id: string;
  workshop_name?: string;
  workshops: RegistrationWorkshopOption[];
  greeting?: string | null;
  is_active: boolean;
  submission_count: number;
  created_at: string;
  updated_at: string;
}

export interface RegistrationFormPublic {
  token: string;
  greeting?: string | null;
  is_active: boolean;
  workshop_id: string;
  workshop_name: string;
  workshop_event_date?: string | null;
  workshop_location?: string | null;
  workshops: RegistrationWorkshopOption[];
}

export async function listRegistrationForms(): Promise<RegistrationForm[]> {
  return await api("/registration-forms");
}

export async function createRegistrationForm(body: {
  workshop_ids: string[];
  greeting?: string;
}): Promise<RegistrationForm> {
  return await api("/registration-forms", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateRegistrationForm(
  id: string,
  body: { greeting?: string; is_active?: boolean; workshop_ids?: string[] },
): Promise<RegistrationForm> {
  return await api("/registration-forms/" + id, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteRegistrationForm(id: string): Promise<void> {
  await api("/registration-forms/" + id, { method: "DELETE" });
}

export async function getPublicRegistrationForm(
  token: string,
): Promise<RegistrationFormPublic> {
  return await api("/public/registration-forms/" + encodeURIComponent(token));
}

export async function submitPublicRegistrationForm(
  token: string,
  body: { workshop_id: string; full_name: string; phone: string; party_size: number; business_model?: string; source: string; source_detail?: string },
): Promise<{ registration_status: "pending" | "confirmed" }> {
  return await api("/public/registration-forms/" + encodeURIComponent(token) + "/submit", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// -----------------------------------------------------------------
// Quản lý ZBS Template
// -----------------------------------------------------------------

export async function listZbsTemplates(params: {
  offset?: number;
  limit?: number;
  status?: ZbsTemplateStatus | "";
  search?: string;
} = {}): Promise<ZbsTemplateListResponse> {
  const query = new URLSearchParams({
    offset: String(params.offset || 0),
    limit: String(params.limit || 20),
  });
  if (params.status) query.set("status", params.status);
  if (params.search?.trim()) query.set("search", params.search.trim());
  return api(`/zbs/templates?${query.toString()}`);
}

export async function getZbsTemplate(templateId: string): Promise<ZbsTemplateDetail> {
  return api(`/zbs/templates/${encodeURIComponent(templateId)}`);
}

export async function syncZbsTemplates(): Promise<ZbsSyncResult> {
  return api("/zbs/templates/sync", { method: "POST" });
}

export function getZbsOAuthStatus(): Promise<ZbsOAuthStatusResponse> {
  return api("/zbs/oauth/status");
}

export function refreshZbsOAuth(): Promise<ZbsOAuthStatusResponse> {
  return api("/zbs/oauth/refresh", { method: "POST" });
}

export function testZbsOAuth(): Promise<ZbsOAuthStatusResponse> {
  return api("/zbs/oauth/test", { method: "POST" });
}

export async function listZbsTaskConfigs(): Promise<ZbsTaskConfig[]> {
  return api("/zbs/task-configs");
}

export async function updateZbsTaskConfig(
  taskKey: ZbsTaskKey,
  body: { enabled: boolean; template_id: string | null },
): Promise<ZbsTaskConfig> {
  return api(`/zbs/task-configs/${encodeURIComponent(taskKey)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function getZaloAgentStatus() {
  return api<import("@/types/zalo-agent").ZaloAgentStatus>("/zalo-agent/status");
}

export function listZaloAgentAccounts() {
  return api<import("@/types/zalo-agent").ZaloAgentAccount[]>("/zalo-agent/accounts");
}

export function startZaloAgentLogin() {
  return api<import("@/types/zalo-agent").ZaloQrSession>("/zalo-agent/login", { method: "POST" });
}

export function getZaloAgentLogin(sessionId: string) {
  return api<import("@/types/zalo-agent").ZaloQrSession>(`/zalo-agent/login/${encodeURIComponent(sessionId)}`);
}

export function switchZaloAgentAccount(ownerId: string) {
  return api<import("@/types/zalo-agent").ZaloAgentStatus>("/zalo-agent/accounts/switch", { method: "POST", body: JSON.stringify({ owner_id: ownerId }) });
}

export function logoutZaloAgent(purge = false) {
  return api<import("@/types/zalo-agent").ZaloAgentStatus>("/zalo-agent/logout", { method: "POST", body: JSON.stringify({ purge }) });
}

export function reconnectZaloAgent() {
  return api<import("@/types/zalo-agent").ZaloAgentStatus>("/zalo-agent/reconnect", { method: "POST" });
}

export function removeZaloAgentAccount(ownerId: string) {
  return api<{ removed: boolean }>(`/zalo-agent/accounts/${encodeURIComponent(ownerId)}`, { method: "DELETE" });
}

// -----------------------------------------------------------------
// Zalo cá nhân: mẫu tin và gửi hàng loạt
// -----------------------------------------------------------------

type ZaloTemplateApi = Omit<ZaloMessageTemplate, "blocks"> & { content_blocks: Array<Record<string, any>> };

function normalizeZaloTemplate(template: ZaloTemplateApi): ZaloMessageTemplate {
  return {
    ...template,
    auto_send_new_guest: Boolean(template.auto_send_new_guest),
    auto_send_checkin: Boolean(template.auto_send_checkin),
    blocks: template.content_blocks.map((block, blockIndex) => {
      if (block.type === "image_album") {
        return {
          id: String(block.id || blockIndex),
          type: "image" as const,
          images: (Array.isArray(block.images) ? block.images : []).map((image: Record<string, any>, imageIndex: number) => ({
            id: String(image.id || `${blockIndex}-${imageIndex}`),
            url: String(image.url || ""),
          })),
        };
      }
      if (block.type === "image") {
        return {
          id: String(block.id || blockIndex),
          type: "image" as const,
          images: block.url ? [{ id: String(block.id || `${blockIndex}-0`), url: String(block.url) }] : [],
        };
      }
      return {
        id: String(block.id || blockIndex),
        type: block.type,
        text: block.text,
        url: block.url,
        thumbnail_url: block.thumbnail_url,
      };
    }),
  };
}

function zaloTemplatePayload(body: ZaloMessageTemplateInput) {
  return {
    name: body.name,
    description: body.description || null,
    status: body.status,
    auto_send_new_guest: Boolean(body.auto_send_new_guest),
    auto_send_checkin: Boolean(body.auto_send_checkin),
    content_blocks: body.blocks.map((block) => block.type === "image"
      ? { type: "image_album", images: (block.images?.length ? block.images : block.url ? [{ id: block.id, url: block.url }] : []).map((image) => ({ url: image.url })) }
      : block.type === "text"
        ? { type: "text", text: block.text }
        : { type: "video", url: block.url, thumbnail_url: block.thumbnail_url }),
  };
}

export async function listZaloMessageTemplates(params: {
  offset?: number;
  limit?: number;
  status?: ZaloMessageTemplateStatus | "";
  search?: string;
} = {}): Promise<ZaloMessageTemplateListResponse> {
  const templates = (await api<ZaloTemplateApi[]>(`/zalo/templates?${new URLSearchParams({
    ...(params.status ? { status: params.status } : {}),
    ...(params.search ? { search: params.search } : {}),
    offset: "0", limit: "100",
  })}`)).map(normalizeZaloTemplate);
  const term = params.search?.trim().toLocaleLowerCase("vi") || "";
  const filtered = templates.filter((template) => (!params.status || template.status === params.status)
    && (!term || `${template.name} ${template.description || ""}`.toLocaleLowerCase("vi").includes(term)));
  const offset = params.offset || 0;
  const limit = params.limit || 20;
  return { data: filtered.slice(offset, offset + limit), metadata: { total: filtered.length, offset, limit } };
}

export async function createZaloMessageTemplate(body: ZaloMessageTemplateInput): Promise<ZaloMessageTemplate> {
  return normalizeZaloTemplate(await api<ZaloTemplateApi>("/zalo/templates", { method: "POST", body: JSON.stringify(zaloTemplatePayload(body)) }));
}

export async function updateZaloMessageTemplate(id: string, body: ZaloMessageTemplateInput): Promise<ZaloMessageTemplate> {
  return normalizeZaloTemplate(await api<ZaloTemplateApi>(`/zalo/templates/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(zaloTemplatePayload(body)) }));
}

export function deleteZaloMessageTemplate(id: string): Promise<void> {
  return api(`/zalo/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function uploadZaloMessageMedia(file: File, type: "image" | "video" | "thumbnail"): Promise<ZaloMediaUploadResult> {
  const form = new FormData();
  form.set("file", file);
  return apiForm(`/zalo/media?kind=${encodeURIComponent(type)}`, form);
}

const FALLBACK_ZALO_TEMPLATE_VARIABLES: ZaloTemplateVariable[] = [
  { key: "{{full_name}}", label: "Họ tên khách", group: "Guest" },
  { key: "{{phone}}", label: "Số điện thoại", group: "Guest" },
  { key: "{{company}}", label: "Công ty", group: "Guest" },
  { key: "{{role_title}}", label: "Chức danh", group: "Guest" },
  { key: "{{guest_type}}", label: "Loại khách", group: "Guest" },
  { key: "{{workshop_name}}", label: "Tên workshop", group: "Workshop" },
  { key: "{{workshop_date}}", label: "Ngày tổ chức", group: "Workshop" },
  { key: "{{workshop_time}}", label: "Giờ tổ chức", group: "Workshop" },
  { key: "{{workshop_location}}", label: "Địa điểm", group: "Workshop" },
  { key: "{{workshop_branch}}", label: "Chi nhánh", group: "Workshop" },
];

export async function getZaloTemplateVariables(): Promise<ZaloTemplateVariable[]> {
  try {
    const response = await api<unknown>("/zalo/template-variables");
    const grouped = response && typeof response === "object" && !Array.isArray(response)
      ? response as Record<string, unknown>
      : {};
    const items: Array<{ item: unknown; defaultGroup?: "Guest" | "Workshop" }> = Array.isArray(response)
      ? response.map((item) => ({ item }))
      : "data" in grouped && Array.isArray(grouped.data)
        ? grouped.data.map((item) => ({ item }))
        : [
            ...(Array.isArray(grouped.guest) ? grouped.guest.map((item) => ({ item, defaultGroup: "Guest" as const })) : []),
            ...(Array.isArray(grouped.workshop) ? grouped.workshop.map((item) => ({ item, defaultGroup: "Workshop" as const })) : []),
          ];
    const variables = items.flatMap(({ item, defaultGroup }): ZaloTemplateVariable[] => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const rawKey = String(record.key || record.variable || record.name || "").trim();
      if (!rawKey) return [];
      const key = rawKey.startsWith("{{") ? rawKey : `{{${rawKey}}}`;
      const rawGroup = String(record.group || record.category || defaultGroup || "Guest").toLocaleLowerCase("vi");
      return [{
        key,
        label: String(record.label || record.title || rawKey),
        group: rawGroup.includes("workshop") ? "Workshop" : "Guest",
        description: record.description ? String(record.description) : undefined,
      }];
    });
    return variables.length ? variables : FALLBACK_ZALO_TEMPLATE_VARIABLES;
  } catch {
    return FALLBACK_ZALO_TEMPLATE_VARIABLES;
  }
}

export function cloneZaloMessageTemplate(id: string): Promise<ZaloMessageTemplate> {
  return api<ZaloTemplateApi>(`/zalo/templates/${encodeURIComponent(id)}/clone`, { method: "POST" }).then(normalizeZaloTemplate);
}

export function toggleZaloMessageTemplate(id: string, status: "active" | "archived"): Promise<ZaloMessageTemplate> {
  return api<ZaloTemplateApi>(`/zalo/templates/${encodeURIComponent(id)}/toggle`, {
    method: "POST",
    body: JSON.stringify({ status }),
  }).then(normalizeZaloTemplate);
}

export async function getZaloMessageQuota(): Promise<ZaloMessageQuota> {
  const quota = await api<{ daily_limit: number; used_count: number; reserved_count: number; available_count: number }>("/zalo/quota");
  const reset = new Date();
  reset.setDate(reset.getDate() + 1);
  reset.setHours(0, 0, 0, 0);
  return { used: quota.used_count + quota.reserved_count, limit: quota.daily_limit, remaining: quota.available_count, resets_at: reset.toISOString() };
}

export async function preflightZaloBulkMessage(body: {
  template_id: string;
  workshop_id: string;
  guest_ids: string[];
}): Promise<ZaloBulkPreflight> {
  const [result, quota] = await Promise.all([
    api<{ template_id: string; recipient_count: number; resolved_count: number; unresolved_count: number; quota_required: number; can_send: boolean; eligible: Array<{ guest_id: string }> }>("/zalo/preflight", { method: "POST", body: JSON.stringify({ ...body, refresh_recipients: false }) }),
    getZaloMessageQuota(),
  ]);
  return {
    template_id: result.template_id,
    total: result.recipient_count,
    eligible_count: result.resolved_count,
    ineligible_count: result.unresolved_count,
    eligible_guest_ids: result.eligible.map((guest) => guest.guest_id),
    quota_remaining: quota.remaining,
    can_send: result.can_send && result.quota_required <= quota.remaining,
  };
}

export async function sendZaloBulkMessage(body: {
  template_id: string;
  guest_ids: string[];
}): Promise<ZaloBulkSendResult> {
  const delivery = await api<{
    id: string; status: string; recipient_count: number; sent_count: number; failed_count: number;
    items?: Array<{ guest_id: string; recipient_name?: string; status: ZaloBulkSendResult["results"] extends Array<infer T> ? T extends { status: infer S } ? S : never : never; last_error?: string }>;
  }>("/zalo/batches", { method: "POST", body: JSON.stringify({ ...body, idempotency_key: crypto.randomUUID() }) });
  return {
    batch_id: delivery.id,
    status: delivery.status,
    total: delivery.recipient_count,
    sent: delivery.sent_count,
    failed: delivery.failed_count,
    skipped: 0,
    results: delivery.items?.map((item) => ({ guest_id: item.guest_id, full_name: item.recipient_name, status: item.status, error: item.last_error })),
  };
}

export function listZaloGuestSendStatuses(
  workshopId: string,
  templateId: string,
): Promise<ZaloGuestSendStatus[]> {
  const params = new URLSearchParams({
    workshop_id: workshopId,
    template_id: templateId,
  });
  return api<ZaloGuestSendStatus[]>(`/zalo/guest-send-statuses?${params}`);
}

export function preflightZaloRecipient(body: { template_id: string; guest_id: string; refresh_recipients?: boolean }) {
  return api<{ template_id: string; recipient_count: number; resolved_count: number; unresolved_count: number; quota_required: number }>("/zalo/preflight", {
    method: "POST",
    body: JSON.stringify({ template_id: body.template_id, guest_ids: [body.guest_id], refresh_recipients: body.refresh_recipients ?? false }),
  });
}

export function sendZaloMessage(body: { template_id: string; guest_id: string }): Promise<ZaloDelivery> {
  return api<ZaloDelivery>("/zalo/send", { method: "POST", body: JSON.stringify({ ...body, idempotency_key: crypto.randomUUID() }) });
}

export function listZaloDeliveries(guestId?: string, offset = 0, limit = 20, templateId?: string): Promise<ZaloDelivery[]> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  if (guestId) params.set("guest_id", guestId);
  if (templateId) params.set("template_id", templateId);
  return api<ZaloDelivery[]>(`/zalo/deliveries?${params}`);
}

export function getZaloDelivery(id: string): Promise<ZaloDelivery> {
  return api<ZaloDelivery>(`/zalo/deliveries/${encodeURIComponent(id)}`);
}

export function refreshZaloDeliveryItem(id: string): Promise<ZaloDeliveryItem> {
  return api<ZaloDeliveryItem>(`/zalo/delivery-items/${encodeURIComponent(id)}/refresh`, { method: "POST" });
}

export function retryZaloDeliveryItem(id: string): Promise<ZaloDeliveryItem> {
  return api<ZaloDeliveryItem>(`/zalo/delivery-items/${encodeURIComponent(id)}/retry`, { method: "POST" });
}
