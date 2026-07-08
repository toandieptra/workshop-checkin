/**
 * Edge-runtime friendly: chỉ dùng Web Crypto API có sẵn ở cả Node 20 và
 * Edge runtime (Next.js middleware). KHÔNG dùng node:crypto.
 */

export const SESSION_COOKIE = "admin_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày
export const CSRF_HEADER = "x-admin-session";

/**
 * Trả về true nếu secret đã được cấu hình và đủ dài (≥ 32 ký tự). Fail-closed.
 */
export function isSessionSecretConfigured(): boolean {
  const s = process.env.ADMIN_SESSION_SECRET;
  return !!s && s.length >= 32;
}

/**
 * Trả về true nếu password đã được cấu hình. Fail-closed.
 */
export function isAdminPasswordConfigured(): boolean {
  const p = process.env.ADMIN_PASSWORD;
  return !!p && p.length > 0;
}

function getSecret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET chưa được cấu hình hoặc quá ngắn (cần ≥ 32 ký tự).");
  }
  return s;
}

function base64url(buf: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof buf === "string") {
    bytes = new TextEncoder().encode(buf);
  } else if (buf instanceof Uint8Array) {
    bytes = buf;
  } else {
    bytes = new Uint8Array(buf);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
}

/**
 * Tính HMAC SHA-256 bằng Web Crypto. Cả Node 20 và Edge runtime đều có
 * `globalThis.crypto.subtle`.
 */
async function hmac(payload: string): Promise<Uint8Array> {
  const keyData = new TextEncoder().encode(getSecret());
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return new Uint8Array(sig);
}

/**
 * Constant-time compare 2 chuỗi hex. Edge runtime không có timingSafeEqual,
 * nhưng việc compare 2 chuỗi hex cùng chiều dài qua vòng for là đủ cho mục
 * đích này (chữ ký đã cố định 64 hex chars, không phụ thuộc payload).
 */
function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Constant-time compare 2 chuỗi (dùng cho password). Lengths có thể khác nhau
 * — vẫn phải chạy toàn bộ loop để tránh leak length.
 */
function constantTimeStringEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function signSession(exp: number): Promise<string> {
  if (!Number.isFinite(exp) || exp <= 0) {
    throw new Error("exp không hợp lệ");
  }
  const payload = base64url(JSON.stringify({ exp }));
  const sigBytes = await hmac(payload);
  const sig = base64url(sigBytes);
  return `${payload}.${sig}`;
}

export type VerifyResult = { ok: true; exp: number } | { ok: false; reason: string };

export async function verifySession(
  cookie: string | undefined | null,
): Promise<VerifyResult> {
  if (!cookie || typeof cookie !== "string") {
    return { ok: false, reason: "missing" };
  }
  const dot = cookie.indexOf(".");
  if (dot <= 0 || dot === cookie.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  const payload = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);

  let expected: Uint8Array;
  let provided: Uint8Array;
  try {
    expected = await hmac(payload);
    provided = base64urlDecode(sig);
  } catch {
    return { ok: false, reason: "decode_error" };
  }
  if (provided.length !== expected.length) {
    return { ok: false, reason: "bad_signature" };
  }
  // So sánh constant-time hex (Web Crypto không có timingSafeEqual ở edge runtime).
  if (!constantTimeHexEqual(toHex(expected), toHex(provided))) {
    return { ok: false, reason: "bad_signature" };
  }

  let parsed: { exp?: unknown };
  try {
    const payloadBytes = base64urlDecode(payload);
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, reason: "bad_payload" };
  }
  const exp = typeof parsed.exp === "number" ? parsed.exp : 0;
  if (!exp || exp <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, exp };
}

/**
 * So sánh 2 chuỗi constant-time (chống timing-attack khi so password).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  return constantTimeStringEqual(a, b);
}