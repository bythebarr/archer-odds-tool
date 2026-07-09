import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteUrl";

// Crawlers get the public product; the API surface (odds polling, crons,
// internal JSON) has no SEO value and shouldn't be indexed.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
