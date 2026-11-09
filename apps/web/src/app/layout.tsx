import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { App as AntApp, ConfigProvider } from 'antd';
import { antdTheme } from '@zitaware/ui';
import { StoreProvider } from '@/store/provider';
import { TrpcProvider } from '@/server/provider';
import { appLocale } from '@/lib/antd-locale';
import './globals.css';

// Zitaware brand typeface (docs/15 §6.1, ADR-191). Downloaded at build time
// and served from this app, so the browser never calls Google.
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-jakarta',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000'),
  title: 'Zitaware CRM',
  description: 'Zitaware Solutions — Innovating Intelligence. Engineering the Future.',
  applicationName: 'Zitaware CRM',
  icons: { icon: '/favicon.png', apple: '/apple-icon.png' },
  openGraph: {
    title: 'Zitaware CRM',
    siteName: 'Zitaware Solutions',
    images: [{ url: '/og.jpg', width: 1200, height: 630, alt: 'Zitaware Solutions' }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jakarta.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <AntdRegistry>
          <ConfigProvider theme={antdTheme} locale={appLocale}>
            {/* App (component={false} = no DOM wrapper) provides the message/
                modal/notification context so screens use App.useApp() and
                toasts inherit the ConfigProvider theme. */}
            <AntApp component={false}>
              <StoreProvider>
                <TrpcProvider>{children}</TrpcProvider>
              </StoreProvider>
            </AntApp>
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
