import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  // Lets a production build run next to a running dev server (NEXT_DIST_DIR=.next-build).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  outputFileTracingRoot: __dirname,
  // Read from disk at runtime (migrations on first connect, demo recall fixtures), so serverless
  // hosts such as Vercel must bundle them with every function.
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*", "./fixtures/**/*"] },
};

export default nextConfig;
