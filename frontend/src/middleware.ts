import { NextRequest, NextResponse } from "next/server";
import { CSRF_HEADER, SESSION_COOKIE, verifySession } from "@/lib/admin-session";

export const config = {
  // Áp dụng cho UI admin + API admin (trừ /api/admin/login để cho phép POST login).
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};

/**
 * Middleware bảo vệ segment /admin/* và /api/admin/*.
 *
 * Quy tắc:
 * - /admin/login  → cho qua (để user đăng nhập).
 * - /api/admin/login → cho qua (login phải khả dụng trước khi có session).
 * - Mọi path khác trong matcher → yêu cầu cookie admin_session hợp lệ.
 *   Thiếu / sai / hết hạn → redirect (UI) hoặc 401 (API).
 * - CSRF: với mọi method không phải GET/HEAD/OPTIONS, yêu cầu header
 *   `x-admin-session: 1` mà browser không gửi cross-site mặc định.
 *   Trình duyệt fetch same-origin set header thủ công ⇒ client phải set.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Bỏ qua login.
  if (
    pathname === "/admin/login" ||
    pathname === "/admin/login/" ||
    pathname === "/api/admin/login" ||
    pathname === "/api/admin/login/"
  ) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const result = await verifySession(cookie);

  if (!result.ok) {
    // API → trả JSON 401. UI → redirect sang /admin/login.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: "Chưa đăng nhập." },
        { status: 401 },
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // CSRF cho non-safe methods.
  const method = req.method.toUpperCase();
  const isSafe = method === "GET" || method === "HEAD" || method === "OPTIONS";
  if (!isSafe) {
    const csrf = req.headers.get(CSRF_HEADER);
    if (csrf !== "1") {
      return NextResponse.json(
        { ok: false, error: "CSRF: thiếu header x-admin-session." },
        { status: 403 },
      );
    }
  }

  // Gắn header để handler downstream (RSC, route handler) biết đã verify.
  const res = NextResponse.next();
  res.headers.set(CSRF_HEADER, "1");
  return res;
}