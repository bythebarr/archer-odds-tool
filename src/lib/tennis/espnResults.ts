/**
 * Recent ATP/WTA singles results from ESPN, written into TennisArchiveMatch
 * after the Sackmann archive's last date, so every player's match log and Elo
 * rating stay current (the archive mirror stopped updating in mid-2026).
 *
 * ESPN gives the set-by-set games, not serve stats, so these rows carry the
 * score (games won, total games, sets) and leave aces and the serve line null.
 * Players join the archive's own ids through the normalized name; an unknown
 * player gets "espn:<athlete id>". Rows use tourneyId "espn:<event id>" and the
 * competition id as matchNum, so re-running never duplicates a match.
 */
import { prisma } from "@/lib/prisma";
import { normalizeName, type Tour } from "./archive";
import { surfaceForSportKey } from "./surface";

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/tennis";

interface Competitor {
  homeAway?: string;
  winner?: boolean;
  linescores?: { value?: number; tiebreak?: number }[];
  athlete?: { id?: string; displayName?: string } | null;
}

interface Payload {
  events?: {
    id?: string;
    name?: string;
    venue?: { displayName?: string };
    groupings?: {
      grouping?: { slug?: string };
      competitions?: { id?: string; date?: string; status?: { type?: { name?: string; completed?: boolean } }; round?: { displayName?: string }; competitors?: Competitor[] }[];
    }[];
  }[];
}

export interface EspnTennisMatch {
  tour: Tour;
  eventId: string;
  eventName: string;
  /** "Basel, Switzerland" → "basel": how the archive names the same tournament. */
  city: string | null;
  competitionId: number;
  date: Date;
  winner: { espnId: string; name: string };
  loser: { espnId: string; name: string };
  /** Sackmann-style, winner first: "6-4 7-6(5)". "RET" appended on a retirement. */
  score: string;
  round: string | null;
}

/** Sackmann's score format from the two linescores, winner first. */
export function scoreLine(w: Competitor["linescores"], l: Competitor["linescores"], retired: boolean): string | null {
  const sets: string[] = [];
  for (let i = 0; i < Math.min(w?.length ?? 0, l?.length ?? 0); i++) {
    const a = w![i]!.value;
    const b = l![i]!.value;
    if (typeof a !== "number" || typeof b !== "number") return null;
    const tb = w![i]!.tiebreak ?? l![i]!.tiebreak;
    const loserTb = typeof tb === "number" && (a === 7 || b === 7) ? Math.min(w![i]!.tiebreak ?? 99, l![i]!.tiebreak ?? 99) : null;
    sets.push(`${a}-${b}${loserTb !== null && loserTb !== 99 ? `(${loserTb})` : ""}`);
  }
  if (!sets.length) return null;
  return sets.join(" ") + (retired ? " RET" : "");
}

/** "womens-singles" → wta, "mens-singles" → atp; else the endpoint's tour. */
export function drawTourOf(slug: string | undefined, fallback: Tour): Tour {
  if (/^wom[ae]n/i.test(slug ?? "")) return "wta";
  if (/^m[ae]n/i.test(slug ?? "")) return "atp";
  return fallback;
}

/**
 * Before the draw decided the tour, a combined event's match was written once
 * per endpoint. Drops the copy whose tour isn't the one the winner mostly plays.
 */
export async function dropDuplicateEspnTennisRows(): Promise<number> {
  return prisma.$executeRaw`
    WITH dup AS (
      SELECT a.id, a.tour, a."winnerSackId" FROM "TennisArchiveMatch" a
      JOIN "TennisArchiveMatch" b ON b."tourneyId" = a."tourneyId" AND b."matchNum" = a."matchNum" AND b.id <> a.id
      WHERE a."tourneyId" LIKE 'espn:%'
    ), usual AS (
      SELECT DISTINCT ON (p) p, tour FROM (
        SELECT "winnerSackId" AS p, tour FROM "TennisArchiveMatch" UNION ALL SELECT "loserSackId", tour FROM "TennisArchiveMatch"
      ) x WHERE p IN (SELECT "winnerSackId" FROM dup) GROUP BY p, tour ORDER BY p, count(*) DESC
    )
    DELETE FROM "TennisArchiveMatch" t USING dup, usual
    WHERE t.id = dup.id AND usual.p = dup."winnerSackId" AND dup.tour <> usual.tour`;
}

/** Completed singles matches on one ET day for one tour (doubles and walkovers dropped). */
export function parseEspnTennisDay(payload: unknown, tour: Tour): EspnTennisMatch[] {
  const out: EspnTennisMatch[] = [];
  for (const ev of (payload as Payload | null)?.events ?? []) {
    for (const g of ev.groupings ?? []) {
      if (g.grouping?.slug && !/singles/i.test(g.grouping.slug)) continue;
      // A combined event (a slam, Indian Wells) comes back whole from both tours: the draw says whose match it is.
      const drawTour = drawTourOf(g.grouping?.slug, tour);
      for (const c of g.competitions ?? []) {
        const status = c.status?.type?.name ?? "";
        // Main draws only, as the archive keeps them (qualifying is a separate Sackmann file).
        if (!c.status?.type?.completed || status === "STATUS_WALKOVER" || /qualif/i.test(c.round?.displayName ?? "")) continue;
        const comps = c.competitors ?? [];
        const w = comps.find((x) => x.winner === true);
        const l = comps.find((x) => x !== w);
        if (!w || !l || comps.length !== 2 || !w.athlete?.displayName || !l.athlete?.displayName) continue;
        const score = scoreLine(w.linescores, l.linescores, /RETIRED/i.test(status));
        const id = Number(c.id);
        if (!score || !Number.isFinite(id) || !c.date) continue;
        out.push({
          tour: drawTour,
          eventId: ev.id ?? "",
          eventName: ev.name ?? "",
          city: ev.venue?.displayName?.split(",")[0]?.trim().toLowerCase() || null,
          competitionId: id,
          date: new Date(c.date),
          winner: { espnId: w.athlete.id ?? "", name: w.athlete.displayName },
          loser: { espnId: l.athlete.id ?? "", name: l.athlete.displayName },
          score,
          round: c.round?.displayName ?? null,
        });
      }
    }
  }
  return out;
}

/** The archive names tournaments by city ("basel"); ESPN gives the city as its venue. City → its usual surface. */
export async function tennisSurfaceByCity(): Promise<Map<string, string>> {
  const rows = await prisma.tennisArchiveMatch.groupBy({
    by: ["tourneyName", "surface"],
    where: { surface: { not: null }, NOT: { tourneyId: { startsWith: "espn:" } } },
    _count: { _all: true },
  });
  const best = new Map<string, { surface: string; n: number }>();
  for (const r of rows) {
    const k = r.tourneyName.toLowerCase();
    const cur = best.get(k);
    if (!cur || r._count._all > cur.n) best.set(k, { surface: r.surface!, n: r._count._all });
  }
  return new Map([...best].map(([k, v]) => [k, v.surface]));
}

export const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

/**
 * Imports ESPN results for the days after the last archived match, oldest
 * first, up to `maxDays` days a run (until `deadline`). Returns how many matches
 * were added and the last day covered.
 */
export async function importEspnTennisResults({ maxDays = 30, deadline = Date.now() + 40_000 }: { maxDays?: number; deadline?: number } = {}): Promise<{ added: number; through: string | null }> {
  const last = await prisma.tennisArchiveMatch.findFirst({ orderBy: { tourneyDate: "desc" }, select: { tourneyDate: true } });
  if (!last) return { added: 0, through: null };
  // ESPN rows carry their match date, archive rows their tournament's start: re-check a week back.
  const from = new Date(last.tourneyDate.getTime() - 7 * 86_400_000);
  const today = new Date();
  const players = new Map<string, string>();
  const known = await prisma.tennisArchiveMatch.findMany({
    where: { tourneyDate: { gte: new Date(today.getTime() - 3 * 365 * 86_400_000) } },
    select: { winnerNorm: true, winnerSackId: true, loserNorm: true, loserSackId: true },
    orderBy: { tourneyDate: "asc" },
  });
  for (const k of known) {
    players.set(k.winnerNorm, k.winnerSackId);
    players.set(k.loserNorm, k.loserSackId);
  }
  const surfaceByCity = await tennisSurfaceByCity();
  const surfaceOf = (m: EspnTennisMatch) => (m.city ? surfaceByCity.get(m.city) : undefined) ?? surfaceForSportKey(m.eventName.toLowerCase().replace(/[^a-z]+/g, "_"));
  let added = 0;
  let through: string | null = null;
  for (let d = 0; d < maxDays && Date.now() < deadline; d++) {
    const day = new Date(from.getTime() + d * 86_400_000);
    if (day > today) break;
    for (const tour of ["atp", "wta"] as const) {
      const res = await fetch(`${SCOREBOARD}/${tour}/scoreboard?dates=${ymd(day)}`, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const matches = parseEspnTennisDay(await res.json(), tour);
      if (!matches.length) continue;
      const idOf = (p: { espnId: string; name: string }) => players.get(normalizeName(p.name)) ?? `espn:${p.espnId}`;
      const r = await prisma.tennisArchiveMatch.createMany({
        data: matches.map((m) => ({
          tour: m.tour,
          tourneyId: `espn:${m.eventId}`,
          tourneyName: m.eventName,
          surface: surfaceOf(m),
          tourneyLevel: null,
          round: m.round,
          tourneyDate: m.date,
          matchNum: m.competitionId,
          bestOf: null,
          winnerSackId: idOf(m.winner),
          winnerName: m.winner.name,
          winnerNorm: normalizeName(m.winner.name),
          loserSackId: idOf(m.loser),
          loserName: m.loser.name,
          loserNorm: normalizeName(m.loser.name),
          score: m.score,
        })),
        skipDuplicates: true,
      });
      added += r.count;
    }
    through = day.toISOString().slice(0, 10);
  }
  return { added, through };
}
