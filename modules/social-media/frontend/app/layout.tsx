import './styles.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Redes Sociais — Via Oceânica AI',
  description: 'Planeamento e produção de publicações para redes sociais com apoio de IA.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-PT">
      <body>{children}</body>
    </html>
  );
}
