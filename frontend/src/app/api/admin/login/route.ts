import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  constantTimeEqual,
  isAdminPasswordConfigured,
  isSessionSecretConfigured,
  signSession,
} from "@/lib/admin-session";
import { checkAndIncrement, reset } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = { limit: 5, windowMs: 5 * 60 * 1000 };

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    // Lấy IP đầu tiên, trim.
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  // Fallback cuối: tránh chia sẻ bucket toàn cục nếu không lấy được IP.
  return "unknown";
}

export async function POST(req: NextRequest) {
  if (!isAdminPasswordConfigured() || !isSessionSecretConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Admin chưa được cấu hình (thiếu ADMIN_PASSWORD hoặc ADMIN_SESSION_SECRET)." },
      { status: 500 },
    );
  }

  const ip = getClientIp(req);
  const bucketKey = `login:${ip}`;
  const limit = checkAndIncrement(bucketKey, RATE_LIMIT);
  if (!limit.ok) {
    const retryAfterSec = Math.ceil(limit.retryAfterMs / 1000);
    return NextResponse.json(
      { ok: false, error: "Quá nhiều lần thử. Vui lòng thử lại sau." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSec),
        },
      },
    );
  }

  // Parse body: hỗ trợ cả JSON lẫn form-encoded.
  let password = "";
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = await req.json();
      if (body && typeof body.password === "string") password = body.password;
    } else if (
      ct.includes("application/x-www-form-urlencoded") ||
      ct.includes("multipart/form-data")
    ) {
      const form = await req.formData();
      const v = form.get("password");
      if (typeof v === "string") password = v;
    } else {
      // Thử JSON phòng trường hợp client không set content-type.
      try {
        const body = await req.json();
        if (body && typeof body.password === "string") password = body.password;
      } catch {
        /* ignore */
      }
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Body không hợp lệ." }, { status: 400 });
  }

  if (!password || password.length > 256) {
    return NextResponse.json(
      { ok: false, error: "Mật khẩu không hợp lệ." },
      { status: 400 },
    );
  }

  const expected = process.env.ADMIN_PASSWORD || "";
  if (!constantTimeEqual(password, expected)) {
    return NextResponse.json({ ok: false, error: "Sai mật khẩu." }, { status: 401 });
  }

  // Reset rate limit cho IP này sau khi login đúng.
  reset(bucketKey);

  const exp = Date.now() + SESSION_TTL_MS;
  const cookie = await signSession(exp);

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: cookie,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}