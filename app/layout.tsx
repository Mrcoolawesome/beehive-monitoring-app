// The root layout — wraps every page. This is where PWA-related setup lives
// that has to apply site-wide: the viewport config that makes the layout
// behave on phones, the metadata that lets iOS treat an installed copy as a
// proper app (Apple doesn't read the web app manifest the way other
// platforms do — it needs its own apple-mobile-web-app-* tags), and
// mounting the service worker registration.

import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ServiceWorkerRegistration from "./components/ServiceWorkerRegistration";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hive Weight Monitor",
  description: "Beehive weight telemetry from F' downlinks",
  // Next.js auto-detects app/icon.png and app/apple-icon.png for the
  // favicon and iOS home-screen icon — no manual <link> tags needed here.
  // The fuller icon set the install prompt itself uses (192/512/maskable)
  // is declared separately in app/manifest.ts.
  appleWebApp: {
    // Tells iOS Safari this page is installable as a standalone app (the
    // "Add to Home Screen" share-sheet option) rather than just bookmarked.
    capable: true,
    title: "Hive Monitor",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // The standard mobile-friendly viewport: render at the device's actual
  // width rather than a desktop-sized virtual viewport zoomed out. Without
  // this, phones show a tiny, pinch-to-zoom-only version of a desktop
  // layout instead of the responsive one Tailwind's `sm:`/`md:` classes
  // are meant to produce.
  width: "device-width",
  initialScale: 1,
  // Matches app/manifest.ts's theme_color — colors browser UI around the
  // page (e.g. Android's address bar) to match the app instead of
  // defaulting to plain white/black.
  themeColor: "#2a78d6",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
