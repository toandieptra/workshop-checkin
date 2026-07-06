// Mặc định dùng relative path để tận dụng Next.js rewrite (xem next.config.js).
// Khi dev local nếu muốn trỏ thẳng backend, set NEXT_PUBLIC_API_URL="http://localhost:8427/api".
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || (typeof window !== "undefined"
  ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`
  : "ws://localhost/ws");

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init.body !== null && init.body !== "";
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (hasBody && !("Content-Type" in headers)) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status}: ${txt}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function apiForm<T = any>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: "POST", body: form, cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export function maskPhone(phone?: string | null): string {
  if (!phone) return "";
  if (phone.length <= 4) return phone;
  return phone.slice(0, 3) + "****" + phone.slice(-2);
}

// -----------------------------------------------------------------
// Self check-in (QR flow) — dùng cho trang guest
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

export async function getWorkshopBySlug(slug: string): Promise<any> {
  return await api("/public/workshops/by-slug/" + encodeURIComponent(slug));
}

export async function getWorkshops(): Promise<any[]> {
  return await api("/workshops");
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
  body: { workshop_id: string; full_name: string; phone: string; party_size: number; business_model?: string },
): Promise<any> {
  return await api("/public/registration-forms/" + encodeURIComponent(token) + "/submit", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
