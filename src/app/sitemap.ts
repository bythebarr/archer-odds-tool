import type { MetadataRoute } from "next";

// Intentionally empty: the tool is a private edge now (see robots.ts +
// proxy.ts), so we don't advertise any URLs for indexing.
export default function sitemap(): MetadataRoute.Sitemap {
  return [];
}
