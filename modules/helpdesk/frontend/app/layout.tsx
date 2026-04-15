import "./globals.css";

export const metadata = {
  title: "Helpdesk",
  description: "Sistema de suporte para clientes e empresas",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <body>{children}</body>
    </html>
  );
}
