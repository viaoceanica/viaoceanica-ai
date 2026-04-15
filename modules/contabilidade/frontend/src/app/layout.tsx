import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ViaContab",
  description: "Módulo de ingestão contabilística",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <body>{children}</body>
    </html>
  );
}
