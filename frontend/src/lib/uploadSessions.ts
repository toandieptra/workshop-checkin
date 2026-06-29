import { API_URL } from "./api";

export interface UploadSession {
  id: string;
  status: string;
  images: { url: string; name: string; size: number; mime: string; ts?: string }[];
  max_files: number;
  expires_at: string;
  upload_url: string;
  token?: string;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status}: ${t}`);
  }
  return res.json() as Promise<T>;
}

export async function createUploadSession(maxFiles = 30): Promise<UploadSession> {
  const res = await fetch(`${API_URL}/upload-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ max_files: maxFiles, subfolder: "qr-upload", ttl_seconds: 600 }),
  });
  return jsonOrThrow(res);
}

export async function getUploadSession(id: string, token: string): Promise<UploadSession> {
  const res = await fetch(`${API_URL}/upload-sessions/${id}?t=${encodeURIComponent(token)}`, { cache: "no-store" });
  return jsonOrThrow(res);
}

export async function closeUploadSession(id: string, token: string): Promise<void> {
  await fetch(`${API_URL}/upload-sessions/${id}/close?t=${encodeURIComponent(token)}`, { method: "POST" });
}

export async function uploadImagesRemote(
  id: string,
  token: string,
  files: File[],
): Promise<{ items: { url: string; name: string; size: number; mime: string }[]; errors: string[] }> {
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  const res = await fetch(`${API_URL}/upload-sessions/${id}/images?t=${encodeURIComponent(token)}`, {
    method: "POST",
    body: fd,
  });
  return jsonOrThrow(res);
}

/**
 * URL mobile se quet QR -> mo trang upload.
 * Uu tien window.location.origin (cung host browser dang dung, hoac IP LAN neu truy qua IP).
 */
export function buildMobileUrl(uploadUrl: string, token: string): string {
  return `${uploadUrl}?t=${encodeURIComponent(token)}`;
}
