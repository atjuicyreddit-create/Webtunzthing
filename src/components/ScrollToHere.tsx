"use client";

import { useEffect, useRef } from "react";

// After posting or deleting a comment the page reloads at the top (the server
// redirect can't keep the #comments anchor), so jump back down to the comments.
export function ScrollToHere() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.closest("section")?.scrollIntoView({ block: "start" });
  }, []);
  return <span ref={ref} hidden />;
}
