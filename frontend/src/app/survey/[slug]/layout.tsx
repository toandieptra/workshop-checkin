import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import "../survey.css";

const montserrat = Montserrat({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--lm-montserrat",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Khảo sát Workshop LerMao",
  description: "Chọn món yêu thích và gửi góp ý cho team LerMao",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default function SurveyLayout({ children }: { children: React.ReactNode }) {
  return <div className={montserrat.variable} style={{ fontFamily: "var(--lm-montserrat), Montserrat, system-ui, sans-serif" }}>{children}</div>;
}
