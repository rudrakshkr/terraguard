import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repo lives inside ~/Documents/repos/terraguard; keep Turbopack rooted
  // here so a stray package-lock.json in $HOME is ignored cleanly.
  turbopack: {
    root: __dirname,
  },
  // File-based stores read/write runtime JSON next to the app. On read-only
  // filesystems (serverless sandboxes without an external KV) fail silently —
  // the app stays fully functional per-instance with an in-memory cache.
  outputFileTracingIncludes: {
    "/api/**": ["./knowledge-base/**"],
  },
};

export default nextConfig;
