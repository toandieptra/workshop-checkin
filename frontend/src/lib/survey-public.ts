/** Public survey client: types, API calls (no cookies — session token header) and local cache. */

import { beginRequest, dedupeRequest } from "@/lib/pending-actions";

export type SurveyImage = { src: string; thumb: string; w: number | null; h: number | null; focus_y: number; alt: string };
export type SurveyItem = {
  key: string; type: "product" | "recipe"; source_id: string; name: string; search: string;
  description: string; group: string; sub: string | null; images: SurveyImage[];
};
export type SurveyGroup = {
  key: string; title: string; short_title: string; tint: string;
  children: { key: string; title: string; short_title: string }[];
};
export type SurveySettings = {
  adjectives: string[]; note_tags: string[]; rating_required: boolean; custom_adjective_slots: number;
  questions: Record<"favorites" | "product_notes" | "impressions" | "discomfort" | "expectation" | "rating", boolean>;
};
export type SurveyInfo = {
  slug: string; title: string; workshop_name: string; event_date: string | null; event_time: string | null; location: string | null;
  brand_line: string; tagline: string; greeting: string; phone_helper: string; hero_image_url: string | null;
  hotline: string; email: string; signature: string; thank_you: string;
  impressions_title: string; impressions_hint: string; discomfort_title: string; discomfort_hint: string;
  expectation_title: string; rating_title: string;
};
export type PublicSurvey = {
  state: "open" | "not_open" | "closed"; opens_at: string | null; closes_at: string | null; closed_at: string | null;
  version_id: string; gift_enabled: boolean; survey: SurveyInfo; settings: SurveySettings; groups: SurveyGroup[]; items: SurveyItem[];
};
export type Draft = {
  favorites: string[];
  notes: Record<string, { tags: string[]; text: string }>;
  adjectives: string[];
  others: string[];
  discomfort: string;
  expectation: string;
  rating: number;
  ui: { tab?: string; cat?: string; sub?: string };
};
export type GiftResult = {
  variant: "gift" | "none" | "ineligible"; reason?: string | null; gift_name?: string; description?: string | null;
  instructions?: string | null; status?: string; expires_at?: string | null; redeemed_at?: string | null; qr?: string; code?: string;
};
export type Submission = { submitted_at: string; rating: number | null; favorite_count: number; gift: GiftResult; quota?: number; remaining?: number };
export type SessionState = {
  full_name: string; phone_masked: string; status: "draft" | "submitted"; draft: Partial<Draft>; revision: number;
  updated_at: string | null; submission: Submission | null;
};

export class SurveyApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

async function call<T>(path: string, init: RequestInit & { token?: string | null; background?: boolean } = {}): Promise<T> {
  const { token, background, ...fetchInit } = init;
  const headers = new Headers(fetchInit.headers);
  if (fetchInit.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("X-Survey-Session", token);
  const url = `/public/surveys/${path}`;
  // Trang khảo sát công khai: chỉ khoá nút / đổi con trỏ khi request do người dùng thao tác.
  const endPending = beginRequest({ global: false, background, method: fetchInit.method ?? "GET" });
  try {
    return await dedupeRequest(fetchInit.method ?? "GET", url, fetchInit, async () => {
      const res = await fetch(url, { ...fetchInit, headers, credentials: "omit", cache: "no-store" });
      if (!res.ok) {
        let code = String(res.status);
        try {
          const body = await res.json();
          if (typeof body.detail === "string") code = body.detail;
        } catch { /* body không phải JSON */ }
        throw new SurveyApiError(res.status, code);
      }
      return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
    });
  } finally {
    endPending();
  }
}

const enc = encodeURIComponent;
export const surveyApi = {
  get: (slug: string) => call<PublicSurvey>(enc(slug)),
  start: (slug: string, full_name: string, phone: string) =>
    call<{ token: string; session: SessionState }>(`${enc(slug)}/sessions`, { method: "POST", body: JSON.stringify({ full_name, phone }) }),
  session: (slug: string, token: string) => call<SessionState>(`${enc(slug)}/session`, { token }),
  save: (slug: string, token: string, draft: Draft) =>
    call<{ revision: number; saved_at: string }>(`${enc(slug)}/session`, { method: "PUT", token, body: JSON.stringify({ draft }), keepalive: true, background: true }),
  discard: (slug: string, token: string) => call<void>(`${enc(slug)}/session`, { method: "DELETE", token }),
  submit: (slug: string, token: string, draft: Draft) =>
    call<{ status: string; submission: Submission; duplicate?: boolean }>(`${enc(slug)}/submit`, { method: "POST", token, body: JSON.stringify({ draft }) }),
  reissue: (slug: string, token: string) => call<{ gift: GiftResult }>(`${enc(slug)}/gift/reissue`, { method: "POST", token }),
};

export const emptyDraft = (slots = 2): Draft => ({
  favorites: [], notes: {}, adjectives: [], others: Array.from({ length: slots }, () => ""),
  discomfort: "", expectation: "", rating: 0, ui: {},
});

export function normalizeDraft(raw: Partial<Draft> | undefined, slots: number): Draft {
  const base = emptyDraft(slots);
  if (!raw) return base;
  const others = Array.isArray(raw.others) ? raw.others.slice(0, slots) : [];
  while (others.length < slots) others.push("");
  return {
    favorites: Array.isArray(raw.favorites) ? raw.favorites : [],
    notes: raw.notes && typeof raw.notes === "object" ? raw.notes : {},
    adjectives: Array.isArray(raw.adjectives) ? raw.adjectives : [],
    others,
    discomfort: raw.discomfort || "",
    expectation: raw.expectation || "",
    rating: typeof raw.rating === "number" ? raw.rating : 0,
    ui: raw.ui || {},
  };
}

/* ---------- Local storage (per slug). Mọi truy cập bọc try/catch: ẩn danh có thể chặn. ---------- */
export type LocalRecord = { token?: string; name?: string; draft?: Draft; gift?: { qr: string; code: string } | null; savedAt?: string };
const storageKey = (slug: string) => `lermao-survey:${slug}`;

export function readLocal(slug: string): LocalRecord {
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function writeLocal(slug: string, patch: Partial<LocalRecord>): boolean {
  try {
    const next = { ...readLocal(slug), ...patch };
    window.localStorage.setItem(storageKey(slug), JSON.stringify(next));
    return true;
  } catch { return false; }
}

export function clearLocal(slug: string): void {
  try { window.localStorage.removeItem(storageKey(slug)); } catch { /* bộ nhớ bị chặn */ }
}

/* ---------- Text helpers ---------- */
export function unaccent(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim().replace(/\s+/g, " ");
}

export function validName(name: string): boolean {
  const len = name.trim().length;
  return len >= 2 && len <= 40;
}

export function validPhone(phone: string): boolean {
  const digits = phone.replace(/[\s.\-()]/g, "");
  return /^(0|\+84|84)(3|5|7|8|9)\d{8}$/.test(digits);
}

export function hhmm(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function ddmm(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
