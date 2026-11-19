import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "THE KHE · Chọn món, nhâm nhi, tận hưởng",
  description: "Đặt matcha, cà phê, trà và bánh tại THE KHE Phú Quốc. Menu, ảnh và giá cập nhật từ quán; hỗ trợ tiếng Việt và English.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
