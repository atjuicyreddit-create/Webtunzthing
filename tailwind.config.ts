import type { Config } from "tailwindcss";

// Colours are CSS variables (see src/app/globals.css) so light/dark mode and
// the brand colour can be changed in ONE place.
const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        line: "var(--line)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        brand: "var(--brand)",
        "brand-ink": "var(--brand-ink)",
        "brand-soft": "var(--brand-soft)",
      },
      fontFamily: {
        sans: [
          "ui-rounded",
          "Nunito",
          "Segoe UI",
          "system-ui",
          "-apple-system",
          "Roboto",
          "sans-serif",
        ],
      },
      maxWidth: { panel: "800px" },
    },
  },
  plugins: [],
};

export default config;
