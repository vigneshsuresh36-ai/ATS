import type { Metadata } from "next";
import { Hanken_Grotesk, Space_Grotesk } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import "./globals.css";
import "./premium.css";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
});

const space = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space",
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
      <body className={`${hanken.variable} ${space.variable}`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
