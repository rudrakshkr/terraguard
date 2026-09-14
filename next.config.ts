import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repo lives inside ~/Documents/repos/terraguard; keep Turbopack rooted
  // here so a stray package-lock.json in $HOME is ignored cleanly.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
