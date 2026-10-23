import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The share-card routes read the bundled display font from disk (src/lib/og.tsx).
  outputFileTracingIncludes: {
    "/opengraph-image": ["src/lib/brand/fonts/**/*"],
    "/twitter-image": ["src/lib/brand/fonts/**/*"],
  },
};

export default nextConfig;
