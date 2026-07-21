export function getPublicOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return "";
}

export function getClientOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export function publicUrl(path: string): string {
  const origin = getPublicOrigin();
  return `${origin}${path}`;
}
