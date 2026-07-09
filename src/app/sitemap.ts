import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteUrl";

// The stable, navigable surfaces. Per-game/per-matchup detail pages are
// intentionally omitted — they churn daily and carry no lasting index value;
// the sport boards above them are the durable entry points.
const ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/slate", priority: 0.9, changeFrequency: "daily" },
  { path: "/props", priority: 0.8, changeFrequency: "daily" },
  { path: "/props/board", priority: 0.8, changeFrequency: "daily" },
  { path: "/sports", priority: 0.7, changeFrequency: "daily" },
  { path: "/mlb", priority: 0.8, changeFrequency: "daily" },
  { path: "/ufc", priority: 0.7, changeFrequency: "daily" },
  { path: "/f1", priority: 0.7, changeFrequency: "daily" },
  { path: "/tennis", priority: 0.6, changeFrequency: "daily" },
  { path: "/soccer", priority: 0.6, changeFrequency: "daily" },
  { path: "/learn", priority: 0.5, changeFrequency: "monthly" },
  { path: "/support", priority: 0.5, changeFrequency: "monthly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ROUTES.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
