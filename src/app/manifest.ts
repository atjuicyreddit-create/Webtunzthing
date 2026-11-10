import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/env";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — comics you steer`,
    short_name: SITE_NAME,
    description: "Vertical-scroll comics where the readers decide what happens next.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fff8ef",
    theme_color: "#b8501a",
    lang: "en-GB",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
