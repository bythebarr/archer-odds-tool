/**
 * ESPN's league injury report (free, unkeyed):
 *   /apis/site/v2/sports/{sport}/{league}/injuries
 * One block per team, each with its injured players, status and note. The
 * whole report is replaced per sport on every sync, so a player who drops off
 * it is healthy again — no stale tags.
 */
import { prisma } from "@/lib/prisma";
import type { Sport } from "@/generated/prisma/client";

const BASE = "https://site.api.espn.com/apis/site/v2/sports";
const PATH: Partial<Record<Sport, string>> = { nba: "basketball/nba", nfl: "football/nfl" };

export interface ParsedInjury {
  espnAthleteId: string;
  playerName: string;
  teamName: string;
  status: string;
  detail: string | null;
}

interface InjuryEntry {
  status?: string;
  shortComment?: string;
  longComment?: string;
  type?: { description?: string };
  details?: { type?: string; returnDate?: string };
  athlete?: { id?: string; displayName?: string; links?: { href?: string }[] };
}

/** The athlete id, from the field or — when the feed omits it — the profile link (".../id/12345/..."). */
function athleteId(a: InjuryEntry["athlete"]): string | null {
  if (a?.id) return String(a.id);
  for (const l of a?.links ?? []) {
    const m = /\/id\/(\d+)/.exec(l.href ?? "");
    if (m) return m[1];
  }
  return null;
}

/** Parses one injury-report payload. Exported for tests against a captured shape. */
export function parseEspnInjuries(payload: unknown): ParsedInjury[] {
  const body = payload as { injuries?: { displayName?: string; injuries?: InjuryEntry[] }[] } | null | undefined;
  const out: ParsedInjury[] = [];
  for (const team of body?.injuries ?? []) {
    const teamName = team.displayName ?? "";
    for (const e of team.injuries ?? []) {
      const id = athleteId(e.athlete);
      const status = e.status ?? e.type?.description;
      if (!id || !e.athlete?.displayName || !status) continue;
      const part = e.details?.type;
      const back = e.details?.returnDate ? `back ~${e.details.returnDate.slice(5, 10).replace("-", "/")}` : null;
      out.push({
        espnAthleteId: id,
        playerName: e.athlete.displayName,
        teamName,
        status,
        detail: [part, back].filter(Boolean).join(" · ") || e.shortComment?.slice(0, 140) || null,
      });
    }
  }
  return out;
}

/** Replaces a sport's stored injury report with ESPN's current one. */
export async function syncInjuries(sport: Sport): Promise<{ sport: Sport; players: number }> {
  const path = PATH[sport];
  if (!path) return { sport, players: 0 };
  const res = await fetch(`${BASE}/${path}/injuries`, { cache: "no-store" });
  if (!res.ok) throw new Error(`ESPN injuries ${sport} ${res.status}`);
  const parsed = parseEspnInjuries(await res.json());
  // An empty report from a healthy feed is real (preseason); an unparseable one isn't, so keep the old report.
  if (parsed.length === 0) return { sport, players: 0 };
  await prisma.$transaction([
    prisma.playerInjury.deleteMany({ where: { sport, espnAthleteId: { notIn: parsed.map((p) => p.espnAthleteId) } } }),
    ...parsed.map((p) =>
      prisma.playerInjury.upsert({
        where: { sport_espnAthleteId: { sport, espnAthleteId: p.espnAthleteId } },
        create: { sport, ...p },
        update: { playerName: p.playerName, teamName: p.teamName, status: p.status, detail: p.detail },
      })
    ),
  ]);
  return { sport, players: parsed.length };
}
