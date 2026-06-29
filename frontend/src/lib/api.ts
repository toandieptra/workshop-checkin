export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8087/api";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8087/ws";

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
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
