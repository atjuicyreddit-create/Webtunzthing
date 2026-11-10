"use client";

import { useEffect } from "react";

// Registers a tiny service worker so the site can be installed to a phone's
// home screen. It does no caching yet (so readers always see the latest panels).
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* installability is a nice-to-have; ignore failures */
    });
  }, []);
  return null;
}
