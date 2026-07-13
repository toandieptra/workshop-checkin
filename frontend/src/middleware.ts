import { NextRequest, NextResponse } from "next/server";

export const config = {
  // Chỉ hỗ trợ redirect UX cho UI; backend vẫn xác thực và phân quyền.
  matcher: ["/admin/:path*"],
};

/**
 * Middleware hỗ trợ redirect nhanh cho segment /admin/*.
 *
 * Quy tắc:
 * - /admin/login  → cho qua (để user đăng nhập).
 * - Mọi path khác chỉ kiểm tra sự hiện diện của opaque session cookie.
 * - Tính hợp lệ, trạng thái active và permission luôn do backend kiểm tra.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Bỏ qua login.
  if (
    pathname === "/admin/login" ||
    pathname === "/admin/login/"
  ) {
    return NextResponse.next();
  }

  // Chỉ kiểm tra sự hiện diện để UX redirect nhanh. Opaque cookie phải do backend
  // xác thực qua /api/auth/me; middleware không kết luận cookie hợp lệ.
  const cookieName = process.env.AUTH_SESSION_COOKIE || "workshop_admin_session";
  const hasAuthCookie = Boolean(req.cookies.get(cookieName)?.value);
  if (!hasAuthCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("redirect", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
