/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  async rewrites() {
    const backend =
      process.env.BACKEND_INTERNAL_URL ||
      (process.env.BACKEND_DEV_LOCAL ? "http://127.0.0.1:8427" : "http://backend:8427");
    // Client FE khi không có NEXT_PUBLIC_API_URL sẽ gọi path không có prefix /api
    // (vd: /workshops, /guests/123). Các rewrite dưới đây map sang backend kèm /api.
    const apiPrefixes = ["export", "workshops", "guests", "checkin", "public", "lark", "thong-ke", "registration-forms", "zbs", "zalo-agent"];
    const rules = apiPrefixes.map((p) => ({
      source: `/${p}/:path*`,
      destination: `${backend}/api/${p}/:path*`,
    }));
    return [
      ...rules,
      // Backward-compat: nếu client gọi /api/* thì vẫn proxy được.
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
      {
        source: "/ws",
        destination: `${backend}/ws`,
      },
      // Static uploads served by backend
      {
        source: "/uploads/:path*",
        destination: `${backend}/uploads/:path*`,
      },
      // Mobile upload page (/m/{sid})
      {
        source: "/m/:path*",
        destination: `${backend}/m/:path*`,
      },
    ];
  },
};
module.exports = nextConfig;
