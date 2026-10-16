import path from "node:path";
import type { NextConfig } from "next";

/** Where the Spring Boot server runs (Next dev server proxies /api/* here). */
const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:8080";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (frontend/Dockerfile).
  output: "standalone",
  // Pin the project root so a stray lockfile in a parent folder can't nest the standalone output.
  outputFileTracingRoot: path.join(__dirname),
  turbopack: { root: path.join(__dirname) },
  experimental: {
    // Close-approach screening over 12 h takes ~40 s; the proxy's default 30 s would cut it off.
    proxyTimeout: 180_000,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
