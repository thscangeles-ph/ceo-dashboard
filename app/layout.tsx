import type { Metadata, Viewport } from "next";
import "@fontsource/source-serif-4/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import { RegisterServiceWorker } from "@/components/pwa";
import "./globals.css";

export const metadata: Metadata = {
  title: "THSC CEO Dashboard",
  description: "Upload THSC Excel reports to generate the CEO summary dashboard: revenue, patients, sources, service mix, referring physicians, and decisions for leadership.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "CEO Dashboard", statusBarStyle: "black-translucent" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#12233d" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1720" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-PH">
      <body>{children}<RegisterServiceWorker /></body>
    </html>
  );
}
