import { loadSecrets } from "./scripts/load-secrets.mjs";

// Real keys live in secrets/.env.local (git-ignored). Load them before anything reads env.
loadSecrets();

/** @type {import('next').NextConfig} */
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : null;

const nextConfig = {
  reactStrictMode: true,
  // The Anthropic SDK is server-only; keep it out of any client bundle.
  serverExternalPackages: ["@anthropic-ai/sdk"],
  images: {
    // Panels are plain <img> tags (see src/components/Reader.tsx), so this is
    // only here for any future next/image use with Supabase Storage.
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost }]
      : [],
  },
};

export default nextConfig;
