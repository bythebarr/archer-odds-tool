/**
 * Upcoming ATP/WTA singles from ESPN's scoreboard as scheduled SportEvents, so
 * tennis boards and props show every main-draw match without an odds feed. Each
 * tournament gets a League ("tennis/espn-<tour>-<event>", provider "espn") whose
 * providerKey "espn:<tour>:<city>" lets the surface be read from the archive.
 *
 * A match an odds feed already lists (same two players within a day) is left to
 * the feed's event, so nothing shows twice. Matches ESPN marks finished move to
 * "final" with the sets each player won.
 */
import { prisma } from "@/lib/prisma";
import { normalizeName, type Tour } from "./archive";
import { drawTourOf, ymd } from "./espnResults";

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/tennis";

interface Competitor {
  homeAway?: string;
  winner?: boolean;
  linescores?: { value?: number }[];
  athlete?: { displayName?: string } | null;
}

interface Payload {
  events?: {
    id?: string;
    name?: string;
    venue?: { displayName?: string };
    groupings?: {
      grouping?: { slug?: string };
      competitions?: { id?: string; date?: string; status?: { type?: { state?: string; completed?: boolean; name?: string } }; round?: { displayName?: string }; competitors?: Competitor[] }[];
    }[];
  }[];
}

export interface EspnTennisFixture {
  tour: Tour;
  eventId: string;
  eventName: string;
  city: string | null;
  competitionId: string;
  startsAt: Date;
  home: string;
  away: string;
  status: "scheduled" | "live" | "final" | "cancelled";
  homeSets: number | null;
  awaySets: number | null;
}

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Main-draw singles with both players named (TBD slots and qualifying dropped). Pure. */
export function parseEspnTennisFixtures(payload: unknown, tour: Tour): EspnTennisFixture[] {
  const out: EspnTennisFixture[] = [];
  for (const ev of (payload as Payload | null)?.events ?? []) {
    for (const g of ev.groupings ?? []) {
      if (!/singles/i.test(g.grouping?.slug ?? "")) continue;
      const drawTour = drawTourOf(g.grouping?.slug, tour);
      for (const c of g.competitions ?? []) {
        if (/qualif/i.test(c.round?.displayName ?? "") || !c.id || !c.date) continue;
        const comps = c.competitors ?? [];
        const h = comps.find((x) => x.homeAway === "home");
        const a = comps.find((x) => x.homeAway === "away");
        const home = h?.athlete?.displayName;
        const away = a?.athlete?.displayName;
        if (comps.length !== 2 || !home || !away || /^tbd$/i.test(home) || /^tbd$/i.test(away)) continue;
        const t = c.status?.type;
        const walkover = t?.name === "STATUS_WALKOVER";
        const status = walkover ? "cancelled" : t?.completed ? "final" : t?.state === "in" ? "live" : "scheduled";
        const sets = (me?: Competitor, them?: Competitor) =>
          (me?.linescores ?? []).filter((s, i) => typeof s.value === "number" && typeof them?.linescores?.[i]?.value === "number" && s.value > them.linescores[i]!.value!).length;
        out.push({
          tour: drawTour,
          eventId: ev.id ?? "",
          eventName: ev.name ?? "",
          city: ev.venue?.displayName?.split(",")[0]?.trim().toLowerCase() || null,
          competitionId: c.id,
          startsAt: new Date(c.date),
          home,
          away,
          status,
          homeSets: status === "final" ? sets(h, a) : null,
          awaySets: status === "final" ? sets(a, h) : null,
        });
      }
    }
  }
  return out;
}

/** Syncs today and the next `days` days of both tours. Returns how many matches were written. */
export async function syncEspnTennisFixtures({ days = 2, now = new Date() }: { days?: number; now?: Date } = {}): Promise<{ written: number; skipped: number }> {
  const byId = new Map<string, EspnTennisFixture>();
  for (let d = 0; d < days; d++) {
    const day = ymd(new Date(now.getTime() + d * 86_400_000));
    for (const tour of ["atp", "wta"] as const) {
      const res = await fetch(`${SCOREBOARD}/${tour}/scoreboard?dates=${day}`, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      // A combined event (a slam) comes back from both tours: first copy wins.
      for (const f of parseEspnTennisFixtures(await res.json(), tour)) if (!byId.has(f.competitionId)) byId.set(f.competitionId, f);
    }
  }
  // The whole tournament comes back: keep what's near now.
  const fixtures = [...byId.values()].filter((f) => f.startsAt.getTime() > now.getTime() - 2 * 86_400_000 && f.startsAt.getTime() < now.getTime() + (days + 1) * 86_400_000);
  if (!fixtures.length) return { written: 0, skipped: 0 };

  // A feed's own event for the same pair wins.
  const feedEvents = await prisma.sportEvent.findMany({
    where: { league: { sport: "tennis", provider: { not: "espn" } }, startsAt: { gte: new Date(now.getTime() - 3 * 86_400_000), lte: new Date(now.getTime() + (days + 2) * 86_400_000) } },
    select: { home: true, away: true, startsAt: true },
  });
  const pair = (a: string, b: string) => [normalizeName(a), normalizeName(b)].sort().join("|");
  const fed = new Map<string, number[]>();
  for (const e of feedEvents) (fed.get(pair(e.home, e.away)) ?? fed.set(pair(e.home, e.away), []).get(pair(e.home, e.away))!).push(e.startsAt.getTime());

  let written = 0;
  let skipped = 0;
  const leagues = new Map<string, string>();
  for (const f of fixtures) {
    if (fed.get(pair(f.home, f.away))?.some((t) => Math.abs(t - f.startsAt.getTime()) < 86_400_000)) {
      skipped++;
      continue;
    }
    const leagueId = `tennis/espn-${f.tour}-${slug(f.eventName) || f.eventId}`;
    if (!leagues.has(leagueId)) {
      const name = `${f.tour.toUpperCase()} ${f.eventName}`;
      await prisma.league.upsert({
        where: { id: leagueId },
        create: { id: leagueId, sport: "tennis", name, provider: "espn", providerKey: `espn:${f.tour}:${f.city ?? ""}:${f.eventId}`, active: true, rank: 500 },
        update: { name, active: true },
      });
      leagues.set(leagueId, leagueId);
    }
    const id = `espn:tennis:${f.competitionId}`;
    const data = { startsAt: f.startsAt, home: f.home, away: f.away, status: f.status, homeScore: f.homeSets, awayScore: f.awaySets };
    await prisma.sportEvent.upsert({ where: { id }, create: { id, leagueId, ...data }, update: data });
    written++;
  }
  for (const leagueId of leagues.keys()) {
    const upcoming = await prisma.sportEvent.findMany({ where: { leagueId, status: { in: ["scheduled", "live"] }, startsAt: { gte: new Date(now.getTime() - 3 * 3_600_000) } }, orderBy: { startsAt: "asc" }, select: { startsAt: true } });
    await prisma.league.update({ where: { id: leagueId }, data: { nextEventAt: upcoming[0]?.startsAt ?? null, upcomingCount: upcoming.length, lastSyncedAt: now } });
  }
  return { written, skipped };
}

/** "espn:atp:basel:23-2026" → "basel". */
export function espnTennisCity(providerKey: string): string | null {
  return providerKey.startsWith("espn:") ? providerKey.split(":")[2] || null : null;
}
