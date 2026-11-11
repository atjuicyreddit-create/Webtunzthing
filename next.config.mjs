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
  // Studio reference images are uploaded through a server action (4 MB max, checked there).
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  // sharp is native; keep it out of the bundle. The lettering fonts are read from disk at run time.
  outputFileTracingIncludes: { "/studio/**": ["./src/fonts/lettering/**"] },
  images: {
    // Panels are plain <img> tags (see src/components/Reader.tsx), so this is
    // only here for any future next/image use with Supabase Storage.
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost }]
      : [],
  },
};

export default nextConfig;
