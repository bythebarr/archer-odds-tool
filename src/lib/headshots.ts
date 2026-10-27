/**
 * Player photos for sports without an official photo CDN we can key into
 * (tennis): Wikipedia's page summary image, accepted only when the page is
 * described as that sport's player, so a namesake never shows up.
 */
const UA = "ARCHR-Edge/1.0 (sports analytics; https://github.com/bythebarr/archer-odds-tool)";

export interface WikiSummary {
  description?: string;
  thumbnail?: { source?: string };
  originalimage?: { source?: string };
}

/** The photo URL from a summary, if it describes a player of the sport. Exported for tests. */
export function pickHeadshot(summary: WikiSummary | null, sport: RegExp): string | null {
  if (!summary?.description || !sport.test(summary.description)) return null;
  return summary.thumbnail?.source ?? summary.originalimage?.source ?? null;
}

export async function wikipediaHeadshot(name: string, sport: RegExp): Promise<string | null> {
  const title = encodeURIComponent(name.trim().replace(/\s+/g, "_"));
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}?redirect=true`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: 60 * 60 * 24 * 7 },
  });
  if (!res.ok) return null;
  return pickHeadshot((await res.json()) as WikiSummary, sport);
}
