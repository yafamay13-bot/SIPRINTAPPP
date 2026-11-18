import '../public/css/app.css';
import './globals.css';
import Script from 'next/script';

export const metadata = {
  title: 'SIPRINT Kabupaten Cirebon',
  description: 'Sistem Informasi Pengiriman dan Pencetakan Dokumen',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>
        {children}
        <Script src="/js/app.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
