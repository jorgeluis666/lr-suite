import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LR Suite",
  description: "Suite operativa para gestion financiera, comercial y de performance.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}