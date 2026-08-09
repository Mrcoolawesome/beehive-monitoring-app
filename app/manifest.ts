// The web app manifest — what makes this a PWA that phones/desktops can
// "install" (add to home screen / dock) rather than just a bookmark. Next.js
// automatically serves whatever this file returns at /manifest.webmanifest
// and links it in every page's <head>; there's no manual <link rel="manifest">
// needed.
//
// Icons live in public/icons/ (generated from a small honeycomb-cell mark —
// see the icon-generation note in docs/planning.md if they ever need
// regenerating) rather than under app/, since a manifest needs several
// specific pixel sizes and Next's app/icon.png convention only covers the
// browser-tab favicon, not the full icon set an OS install prompt expects.

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hive Weight Monitor",
    short_name: "Hive Monitor",
    description: "Beehive weight telemetry from F' downlinks",
    // Where the installed app opens to.
    start_url: "/",
    // "standalone" hides the browser chrome (address bar, tabs) so an
    // installed copy looks and feels like a native app rather than a
    // pinned browser tab.
    display: "standalone",
    // Matches app/globals.css's light-mode --background / --series-1
    // tokens, so the OS splash screen and any browser UI around the app
    // (e.g. Android's status bar while it's open) match the app itself
    // rather than clashing with it.
    background_color: "#f9f9f7",
    theme_color: "#2a78d6",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // A "maskable" icon has its important content kept inside a
        // centered safe zone, because Android (and others) may crop it to
        // a circle, squircle, or other shape depending on the device's
        // icon theme — a plain icon would risk having its edges clipped.
        src: "/icons/maskable-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
