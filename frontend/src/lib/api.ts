import type {
  ZbsSyncResult,
  ZbsTaskConfig,
  ZbsTaskKey,
  ZbsTemplateDetail,
  ZbsTemplateListResponse,
  ZbsTemplateStatus,
} from "@/types/zbs-template";

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
  throw new ApiError(res.status, `${res.status}${text ? ": " + text : ""}`);
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
): Promise<any> {
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
