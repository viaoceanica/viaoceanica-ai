import "./globals.css";

export const metadata = {
  title: "Email",
  description: "Operação de email e automações na Via Oceânica",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <body>{children}</body>
    </html>
  );
}
