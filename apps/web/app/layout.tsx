import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/figtree";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource/noto-serif-sc/500.css";
import "./tokens.css";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "fluffdesk",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
  appleWebApp: { capable: true, title: "fluffdesk" },
};

export const viewport: Viewport = {
  themeColor: "#e9e6ee",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <body>
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  );
}
