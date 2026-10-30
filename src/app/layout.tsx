import type { Metadata } from "next";
import "./globals.css";
import { ro } from "@/lib/i18n/ro";

export const metadata: Metadata = { title: ro.app.name, description: ro.app.tagline };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro">
      <body>{children}</body>
    </html>
  );
}
