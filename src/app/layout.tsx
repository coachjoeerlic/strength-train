import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from '@/lib/AuthContext';
import { ToastProvider } from '@/contexts/ToastContext';
import ToastContainer from '@/components/Toast/ToastContainer';
import InstallPromptBanner from '@/components/PWA/InstallPromptBanner';
import PWAInitializer from "@/components/PWA/PWAInitializer";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Strength Train",
  description: "Track your strength training progress",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        {/* For Client Components, if you need to add tags to head directly, this is one way. */}
        {/* However, Next.js should handle the manifest link from the metadata object. */}
        {/* <link rel="manifest" href="/manifest.json" /> */}
      </head>
      <body className={inter.className}>
        <AuthProvider>
          <ToastProvider>
            <PWAInitializer />
            {children}
            <ToastContainer />
            <InstallPromptBanner />
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
