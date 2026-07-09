import type { MetadataRoute } from "next";

// Private-edge posture: the tool is not a public site anymore (it feeds the
// Discord), so tell every crawler to stay out entirely. The Basic Auth gate in
// proxy.ts already blocks bots at the door once SITE_ACCESS_PASSWORD is set;
// this is the belt-and-suspenders signal for the window before/around that.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
