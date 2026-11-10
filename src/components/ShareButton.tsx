"use client";

import { useState } from "react";

// Uses the phone's share sheet when there is one; otherwise copies the link.
export function ShareButton({ title, path }: { title: string; path: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = new URL(path, window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* cancelled share sheet or blocked clipboard — nothing to do */
    }
  }

  return (
    <button type="button" onClick={share} className="btn btn-quiet w-full sm:w-auto">
      {copied ? "Link copied ✓" : "Share this episode"}
    </button>
  );
}
