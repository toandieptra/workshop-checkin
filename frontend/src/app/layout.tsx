import type { Metadata, Viewport } from "next";
import "./globals.css";
import PendingActionsRoot from "@/components/PendingActionsRoot";

export const metadata: Metadata = {
  title: "Workshop - LerMao x Trà Phượng Hoàng",
  description: "Hệ thống quản lý Workshop của Hi Sweetie Việt Nam",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Check-in" },
  other: { "mobile-web-app-capable": "yes", "zalo-platform-site-verification": "R-7dS8ZGVqvEv-zmZ_9h9rhasn6saWzAD3Gp" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Montserrat:wght@500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <PendingActionsRoot />
        {children}
      </body>
    </html>
  );
}
