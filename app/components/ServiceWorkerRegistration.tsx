// Registers public/sw.js on the client. This has to be its own small client
// component (rather than code directly in layout.tsx, which is a Server
// Component) since `navigator.serviceWorker` only exists in the browser —
// trying to reference it during server rendering would crash the page.
// Renders nothing; it's a side effect only.

"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        // Not fatal — the app still works fully without a service worker,
        // it just won't be installable as a PWA. Worth knowing about in
        // the console during development, though.
        console.error("Service worker registration failed:", err);
      });
    }
  }, []);

  return null;
}
