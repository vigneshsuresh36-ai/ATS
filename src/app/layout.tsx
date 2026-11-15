import type { Metadata } from "next";
import { Carlito } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import "./globals.css";
import "./premium.css";
import "./typography.css";

const carlito = Carlito({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-carlito",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ATS",
  description: "LT Recruitment Project — Talent Acquisition Workspace",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${carlito.variable}`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
