import { api, apiForm, API_URL, type ApiRequestInit } from "@/lib/api";

/**
 * Đường dẫn backend viết dạng "/api/...". Bản build production đặt NEXT_PUBLIC_API_URL
 * = "https://…/api" nên phải bỏ tiền tố để không thành "/api/api/…"; khi API_URL rỗng
 * thì giữ "/api/…" để Next rewrite sang backend.
 */
export function apiPath(path: string): string {
  return API_URL.endsWith("/api") ? path.replace(/^\/api(?=\/)/, "") : path;
}
const call = <T,>(path: string, init?: ApiRequestInit) => api<T>(apiPath(path), init);
const callForm = <T,>(path: string, form: FormData) => apiForm<T>(apiPath(path), form);

export type CatalogKind = "products" | "recipes";
export type CatalogStatus = "active" | "inactive" | "archived";
export type CatalogCategory = {
  id: string; parent_id: string | null; name: string; sort_order: number; is_active: boolean;
  product_count: number; recipe_count: number;
};
export type CatalogImage = { id: string; file_url: string; thumb_url: string; width: number | null; height: number | null; alt: string | null; focus_y: number; sort_order: number };
export type CatalogEntry = {
  id: string; item_type: "product" | "recipe"; name: string; category_id: string | null; short_description: string | null;
  status: CatalogStatus; sort_order: number; images: CatalogImage[]; survey_usage: number; updated_at: string | null;
  instructions?: string | null; product_ids?: string[]; recipe_count?: number;
};
export type PickerItem = { item_type: "product" | "recipe"; source_id: string; name: string; category_id: string | null; status: string; thumb_url: string | null; image_count: number };

export const catalogApi = {
  categories: () => call<CatalogCategory[]>("/api/catalog/categories"),
  createCategory: (body: { name: string; parent_id?: string | null }) => call<CatalogCategory>("/api/catalog/categories", { method: "POST", body: JSON.stringify(body) }),
  updateCategory: (id: string, body: Record<string, unknown>) => call<CatalogCategory>(`/api/catalog/categories/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteCategory: (id: string) => call<void>(`/api/catalog/categories/${id}`, { method: "DELETE" }),
  list: (kind: CatalogKind, params: { q?: string; category_id?: string; status?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return call<CatalogEntry[]>(`/api/catalog/${kind}${qs.toString() ? `?${qs}` : ""}`);
  },
  create: (kind: CatalogKind, body: Record<string, unknown>) => call<CatalogEntry>(`/api/catalog/${kind}`, { method: "POST", body: JSON.stringify(body) }),
  update: (kind: CatalogKind, id: string, body: Record<string, unknown>) => call<CatalogEntry>(`/api/catalog/${kind}/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  remove: (kind: CatalogKind, id: string) => call<void>(`/api/catalog/${kind}/${id}`, { method: "DELETE" }),
  upload: (kind: CatalogKind, id: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return callForm<CatalogEntry>(`/api/catalog/${kind}/${id}/images`, form);
  },
  reorderImages: (kind: CatalogKind, id: string, ids: string[]) => call<CatalogEntry>(`/api/catalog/${kind}/${id}/images/order`, { method: "PUT", body: JSON.stringify(ids) }),
  updateImage: (id: string, body: { alt?: string; focus_y?: number }) => call<CatalogImage>(`/api/catalog/images/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteImage: (id: string) => call<void>(`/api/catalog/images/${id}`, { method: "DELETE" }),
  picker: (params: { q?: string; item_type?: string; category_id?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return call<PickerItem[]>(`/api/catalog/items${qs.toString() ? `?${qs}` : ""}`);
  },
};

export type SurveyContent = Record<string, string | null>;
export type SurveySettingsAdmin = {
  adjectives: string[]; note_tags: string[]; rating_required: boolean; custom_adjective_slots: number;
  questions: Record<string, boolean>;
};
export type StructureGroup = { id?: string; key: string; title: string; short_title: string | null; tint: string | null; parent_key: string | null };
export type StructureItem = {
  id?: string; item_type: "product" | "recipe"; source_id: string; group_key: string | null; display_name: string | null;
  catalog_name?: string; catalog_status?: string; thumb_url?: string | null; image_count?: number; image_override_url?: string | null;
};
export type SurveyAdmin = {
  id: string; workshop_id: string; slug: string; title: string; status: "draft" | "published" | "closed";
  public_state: "draft" | "open" | "not_open" | "closed"; opens_at: string | null; closes_at: string | null;
  content: SurveyContent; settings: SurveySettingsAdmin; current_version_id: string | null; current_version_item_count: number | null;
  published_at: string | null; updated_at: string | null; versions: { id: string; version_no: number; published_at: string }[];
  session_counts: { draft: number; submitted: number }; public_path: string;
  groups: StructureGroup[]; items: StructureItem[]; published_version_no?: number;
};
export type GiftConfig = {
  enabled: boolean; gift_name: string; description: string | null; instructions: string | null;
  eligibility: "registered" | "confirmed" | "checked_in"; redeem_until: string | null;
};
export type SurveyEnvelope = {
  survey: SurveyAdmin | null; gift_config: GiftConfig;
  defaults?: { slug: string; title: string; content: SurveyContent; settings: SurveySettingsAdmin };
};
export type SurveyResults = {
  total_responses: number; sessions: { draft: number; submitted: number }; invalid_responses: number;
  rating: { average: number | null; count: number; distribution: { rating: number; count: number }[] };
  popularity: { item_type: string; source_id: string; name: string; group: string | null; favorites: number; notes: number; rate: number; tags: { tag: string; count: number }[]; note_samples: string[] }[];
  adjectives: { label: string; count: number }[]; custom_adjectives: { label: string; count: number }[];
  discomfort: { response_id: string; name: string; text: string; submitted_at: string }[];
  expectation: { response_id: string; name: string; text: string; submitted_at: string }[];
  gifts: { issued: number; redeemed: number; expired: number; revoked: number; total: number };
};
export type ResponseRow = {
  id: string; full_name: string; phone_masked: string; rating: number | null; favorite_count: number; adjectives: string[];
  has_feedback: boolean; is_valid: boolean; registered: boolean; gift_status: string | null; claim_id: string | null; submitted_at: string;
};
export type ResponseDetail = {
  id: string; full_name: string; phone_masked: string; rating: number | null; adjectives: string[]; custom_adjectives: string[];
  discomfort: string | null; expectation: string | null; is_valid: boolean; registered: boolean; submitted_at: string; version_no: number | null;
  items: { name: string; group: string | null; item_type: string; favorited: boolean; note_tags: string[]; note_text: string | null }[];
  gift: { status: string; gift_name: string; redeemed_at: string | null } | null;
};
export type GiftClaimRow = {
  claim_id: string; status: string; gift_name: string; guest_name: string; phone_masked: string;
  issued_at: string; redeemed_at: string | null; redeemed_by: string | null; revoke_reason: string | null;
};
export type GiftClaimInfo = {
  claim_id: string; guest_id: string | null; workshop_id: string; workshop_name: string | null; status: string; gift_name: string;
  guest_name: string | null; phone_masked: string | null; rating: number | null; submitted_at: string | null;
  issued_at: string | null; expires_at: string | null; redeemed_at: string | null; redeemed_by: string | null;
};
export type GiftLookup = { result: string; message: string; can_redeem: boolean; claim: GiftClaimInfo | null };

const w = (id: string) => `/api/workshops/${id}`;
export const surveyAdminApi = {
  get: (id: string) => call<SurveyEnvelope>(`${w(id)}/survey`),
  save: (id: string, body: Record<string, unknown>) => call<SurveyAdmin>(`${w(id)}/survey`, { method: "PUT", body: JSON.stringify(body) }),
  saveStructure: (id: string, body: { groups: StructureGroup[]; items: StructureItem[] }) =>
    call<SurveyAdmin>(`${w(id)}/survey/structure`, { method: "PUT", body: JSON.stringify(body) }),
  publish: (id: string) => call<SurveyAdmin>(`${w(id)}/survey/publish`, { method: "POST" }),
  close: (id: string) => call<SurveyAdmin>(`${w(id)}/survey/close`, { method: "POST" }),
  reopen: (id: string) => call<SurveyAdmin>(`${w(id)}/survey/reopen`, { method: "POST" }),
  uploadHero: (id: string, file: File) => { const f = new FormData(); f.append("file", file); return callForm<{ hero_image_url: string }>(`${w(id)}/survey/hero`, f); },
  uploadItemImage: (id: string, itemId: string, file: File) => { const f = new FormData(); f.append("file", file); return callForm<{ image_override_url: string }>(`${w(id)}/survey/items/${itemId}/image`, f); },
  deleteItemImage: (id: string, itemId: string) => call<void>(`${w(id)}/survey/items/${itemId}/image`, { method: "DELETE" }),
  saveGift: (id: string, body: GiftConfig) => call<GiftConfig>(`${w(id)}/gift-config`, { method: "PUT", body: JSON.stringify(body) }),
  results: (id: string, params: Record<string, string> = {}) => call<SurveyResults>(`${w(id)}/survey/results?${new URLSearchParams(params)}`),
  responses: (id: string, params: Record<string, string> = {}) => call<ResponseRow[]>(`${w(id)}/survey/responses?${new URLSearchParams(params)}`),
  response: (id: string, rid: string) => call<ResponseDetail>(`${w(id)}/survey/responses/${rid}`),
  setValid: (id: string, rid: string, is_valid: boolean) => call(`${w(id)}/survey/responses/${rid}`, { method: "PATCH", body: JSON.stringify({ is_valid }) }),
  exportUrl: (id: string, params: Record<string, string> = {}) => `${API_URL}${apiPath(`${w(id)}/survey/export.xlsx`)}?${new URLSearchParams(params)}`,
  gifts: (id: string) => call<{ config: GiftConfig; counts: Record<string, number>; total: number; claims: GiftClaimRow[] }>(`${w(id)}/gifts`),
  revoke: (id: string, claimId: string, reason: string) => call(`${w(id)}/gifts/${claimId}/revoke`, { method: "POST", body: JSON.stringify({ reason }) }),
  audit: (id: string) => call<{ id: string; claim_id: string | null; action: string; result: string; actor: string | null; created_at: string; method: string | null }[]>(`${w(id)}/gifts/audit`),
  lookup: (id: string, code: string, method: "qr" | "manual") => call<GiftLookup>(`${w(id)}/gifts/lookup`, { method: "POST", body: JSON.stringify({ code, method }), adminLoading: false }),
  redeem: (id: string, body: { code: string; claim_id: string; request_id: string; method: "qr" | "manual" }) =>
    call<GiftLookup>(`${w(id)}/gifts/redeem`, { method: "POST", body: JSON.stringify(body), adminLoading: false }),
};

export const GIFT_STATUS_LABEL: Record<string, string> = {
  eligible: "Đủ điều kiện", issued: "Chưa nhận", redeemed: "Đã trao", expired: "Hết hạn", revoked: "Đã thu hồi",
};
export const ELIGIBILITY_LABEL: Record<string, string> = {
  registered: "Có đăng ký workshop (khớp SĐT)", confirmed: "Đăng ký đã xác nhận", checked_in: "Đã check-in tại workshop",
};
export const TINTS = [
  { value: "#FFE9EE", label: "Hồng" }, { value: "#FFF3D6", label: "Vàng" },
  { value: "#E3F6EC", label: "Xanh lá" }, { value: "#E6F3FD", label: "Xanh dương" }, { value: "#f5f5f5", label: "Xám" },
];

export function fmtDateTime(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
}

export function toLocalInput(v?: string | null): string {
  if (!v) return "";
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}
