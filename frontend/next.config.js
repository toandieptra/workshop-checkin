/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  async rewrites() {
    const backend =
      process.env.BACKEND_INTERNAL_URL || "http://backend:8427";
    return [
      // API: route mọi /api/* qua backend trong docker network
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
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
      // WebSocket: Next.js standalone không proxy WS qua rewrites.
      // /ws được xử lý trực tiếp bởi backend (qua nginx sidecar hoặc Cloudflare Origin Rule riêng).
      // Nếu browser gọi tới Next.js thì Next.js sẽ match /api style fallback;
      // ta KHÔNG rewrite /ws ở đây để tránh hang.
    ];
  },
};
module.exports = nextConfig;