import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Workshop Check-in — Hi Sweetie Việt Nam",
  description: "Hệ thống check-in khuôn mặt Workshop Chuyển",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Check-in" },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
