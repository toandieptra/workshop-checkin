import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Đăng ký Workshop LerMao x Trà Phượng Hoàng",
  description:
    "Đăng ký suất tham dự Workshop và nhận thông tin xác nhận từ đội ngũ của nhà gấu LerMao",
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
