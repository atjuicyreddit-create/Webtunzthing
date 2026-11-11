"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// While images are generating, check their jobs every few seconds and refresh the page
// when any finishes. Closing the tab is fine: the jobs carry on and are checked next visit.
export function JobPoller({ jobIds }: { jobIds: string[] }) {
  const router = useRouter();
  const [left, setLeft] = useState(jobIds.length);
  const busy = useRef(false);
  const key = jobIds.join(",");

  useEffect(() => {
    if (!key) return;
    let stopped = false;
    let pending = key.split(",");
    setLeft(pending.length);
    const tick = async () => {
      if (busy.current || stopped) return;
      busy.current = true;
      try {
        const r = await fetch("/studio/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: pending }),
        });
        if (r.ok) {
          const { jobs } = (await r.json()) as { jobs: { id: string; status: string }[] };
          const finished = jobs.filter((j) => j.status !== "running").map((j) => j.id);
          if (finished.length) {
            pending = pending.filter((id) => !finished.includes(id));
            setLeft(pending.length);
            router.refresh();
          }
        }
      } finally {
        busy.current = false;
      }
      if (!pending.length) stopped = true;
    };
    const t = setInterval(tick, 4000);
    void tick();
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [key, router]);

  if (!left) return null;
  return (
    <p role="status" aria-live="polite" className="s-card mt-3 flex items-center gap-2 p-3 text-sm font-bold">
      <span className="inline-block size-3 animate-pulse rounded-full bg-[var(--s-magenta)]" aria-hidden="true" />
      Generating {left} image{left === 1 ? "" : "s"}… this page updates by itself. You can leave and come back.
    </p>
  );
}
