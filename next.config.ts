import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  // The production host has limited memory; a single build worker avoids an
  // OOM-killed artifact while leaving runtime request concurrency unchanged.
  experimental: { cpus: 1 },
  webpack(config, { dev }) {
    if (!dev) config.cache = false;
    return config;
  },
  async headers() {
    return [
      { source: "/(.*)", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }, { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }, { key: "X-Frame-Options", value: "SAMEORIGIN" }] },
      { source: "/reset-password", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store, max-age=0" }] },
    ];
  },
};

export default nextConfig;
