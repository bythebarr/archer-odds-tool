/**
 * The app's absolute base URL, resolved once for metadata, robots, and the
 * sitemap. Prefers an explicit NEXT_PUBLIC_SITE_URL, then Vercel's stable
 * production domain, then localhost for dev.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");
