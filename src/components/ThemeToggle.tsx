"use client";

import { useEffect, useState } from "react";

type Choice = "system" | "light" | "dark";
const ORDER: Choice[] = ["system", "light", "dark"];
const LABEL: Record<Choice, string> = { system: "Auto", light: "Light", dark: "Dark" };

function Icon({ choice }: { choice: Choice }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (choice === "light") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (choice === "dark") {
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  }
  // Auto: a circle that is half light, half dark.
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </svg>
  );
}

function apply(choice: Choice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("system");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark") setChoice(saved);
    } catch {
      /* storage can be blocked (private windows) — Auto still works */
    }
  }, []);

  function next() {
    const nextChoice = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];
    setChoice(nextChoice);
    apply(nextChoice);
    try {
      if (nextChoice === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", nextChoice);
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={next}
      className="btn btn-quiet !min-h-11 !min-w-11 !px-3 text-sm"
      aria-label={`Colour mode: ${LABEL[choice]}. Tap to change.`}
      title={`Colour mode: ${LABEL[choice]}`}
    >
      <Icon choice={choice} />
      <span className="hidden sm:inline">{LABEL[choice]}</span>
    </button>
  );
}
