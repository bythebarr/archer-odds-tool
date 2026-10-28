/**
 * Soccer player match logs from ESPN's match summaries: every player who got on
 * the pitch, with his minutes (from his own substitution and red-card times),
 * goals, assists, shots, shots on target, saves, cards and fouls — what soccer
 * player props are priced from. Free; one summary per finished match.
 */
import { prisma } from "@/lib/prisma";

const BASE = "https://site.api.espn.com/apis/site/v2/sports";

export type SoccerPosition = "G" | "D" | "M" | "F";

export interface SoccerMatchLine {
  playerId: string;
  name: string;
  position: SoccerPosition | null;
  headshotUrl: string | null;
  team: string;
  opponent: string;
  isHome: boolean;
  starter: boolean;
  minutes: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  saves: number;
  yellowCards: number;
  redCards: number;
  fouls: number;
}

interface RosterPlay {
  clock?: { displayValue?: string };
  substitution?: boolean;
  redCard?: boolean;
}

interface RosterEntry {
  starter?: boolean;
  subbedIn?: boolean;
  subbedOut?: boolean;
  athlete?: { id?: string; displayName?: string; headshot?: { href?: string } };
  position?: { abbreviation?: string };
  stats?: { name: string; value?: number }[];
  plays?: RosterPlay[];
}

export interface EspnSoccerSummary {
  header?: { competitions?: { status?: { type?: { name?: string } } }[] };
  rosters?: { homeAway?: "home" | "away"; team?: { displayName?: string }; roster?: RosterEntry[] }[];
}

/** ESPN's position codes (G, CD-L, LB, DM, AM-R, CF, …) as four groups; null for "SUB" and unknowns. */
export function positionGroup(abbr: string | undefined): SoccerPosition | null {
  const a = (abbr ?? "").toUpperCase();
  if (!a || a === "SUB") return null;
  if (a === "G" || a === "GK") return "G";
  if (/^(CD|CB|LB|RB|D|LWB|RWB|SW)\b/.test(a) || a.startsWith("CD-")) return "D";
  if (/M/.test(a)) return "M";
  if (/^(F|CF|ST|LW|RW|LF|RF|SS|W)/.test(a)) return "F";
  return null;
}

/** "52'" → 52; "90'+3'" → 90; "45'+2'" → 45. */
export function clockMinute(display: string | undefined): number | null {
  const m = /^(\d+)'/.exec((display ?? "").trim());
  return m ? Number(m[1]) : null;
}

/** Minutes on the pitch from when he came on (0 for a starter) to his substitution or red card. */
export function minutesPlayed(e: RosterEntry, matchLength: number): number {
  const subs = (e.plays ?? []).filter((p) => p.substitution).map((p) => clockMinute(p.clock?.displayValue)).filter((m): m is number => m !== null);
  const red = (e.plays ?? []).filter((p) => p.redCard).map((p) => clockMinute(p.clock?.displayValue)).find((m) => m !== null) ?? null;
  const on = e.starter ? 0 : e.subbedIn ? (subs[0] ?? matchLength - 15) : null;
  if (on === null) return 0;
  const offs = [e.subbedOut ? (e.starter ? subs[0] : subs[1]) : undefined, red ?? undefined].filter((m): m is number => m !== undefined);
  const off = offs.length ? Math.min(...offs) : matchLength;
  return Math.max(1, Math.min(matchLength, off) - Math.min(on, matchLength - 1));
}

/** Every player who played in the match; empty when ESPN has no box score for it. */
export function parseSoccerSummary(body: EspnSoccerSummary): SoccerMatchLine[] {
  const status = body.header?.competitions?.[0]?.status?.type?.name ?? "";
  const matchLength = /AET|PEN|EXTRA/i.test(status) ? 120 : 90;
  const sides = body.rosters ?? [];
  if (sides.length !== 2) return [];
  const out: SoccerMatchLine[] = [];
  for (const side of sides) {
    const team = side.team?.displayName;
    const opponent = sides.find((s) => s !== side)?.team?.displayName;
    if (!team || !opponent) continue;
    for (const e of side.roster ?? []) {
      const id = e.athlete?.id;
      if (!id || !(e.starter || e.subbedIn)) continue;
      const st = Object.fromEntries((e.stats ?? []).map((s) => [s.name, s.value ?? 0]));
      const n = (k: string) => Math.max(0, Math.round(Number(st[k] ?? 0)));
      out.push({
        playerId: id,
        name: e.athlete?.displayName ?? id,
        position: positionGroup(e.position?.abbreviation),
        headshotUrl: e.athlete?.headshot?.href ?? null,
        team,
        opponent,
        isHome: side.homeAway === "home",
        starter: !!e.starter,
        minutes: minutesPlayed(e, matchLength),
        goals: n("totalGoals"),
        assists: n("goalAssists"),
        shots: n("totalShots"),
        shotsOnTarget: n("shotsOnTarget"),
        saves: n("saves"),
        yellowCards: n("yellowCards"),
        redCards: n("redCards"),
        fouls: n("foulsCommitted"),
      });
    }
  }
  return out;
}

async function storeMatch(event: { id: string; leagueId: string; startsAt: Date }, lines: SoccerMatchLine[]) {
  if (lines.length) {
    // Team and position follow the player's latest match, so a backfill of old matches never moves him back.
    await prisma.$executeRaw`
      INSERT INTO "SoccerPlayer" ("id", "name", "position", "team", "headshotUrl", "lastMatchAt", "updatedAt")
      SELECT id, name, position, team, headshot, ${event.startsAt}::timestamp, now()
      FROM unnest(${lines.map((l) => l.playerId)}::text[], ${lines.map((l) => l.name)}::text[], ${lines.map((l) => l.position)}::text[], ${lines.map((l) => l.team)}::text[], ${lines.map((l) => l.headshotUrl)}::text[])
        AS t(id, name, position, team, headshot)
      ON CONFLICT ("id") DO UPDATE SET
        "name" = EXCLUDED."name",
        "headshotUrl" = COALESCE(EXCLUDED."headshotUrl", "SoccerPlayer"."headshotUrl"),
        "position" = CASE WHEN "SoccerPlayer"."lastMatchAt" IS NULL OR EXCLUDED."lastMatchAt" >= "SoccerPlayer"."lastMatchAt" THEN COALESCE(EXCLUDED."position", "SoccerPlayer"."position") ELSE COALESCE("SoccerPlayer"."position", EXCLUDED."position") END,
        "team" = CASE WHEN "SoccerPlayer"."lastMatchAt" IS NULL OR EXCLUDED."lastMatchAt" >= "SoccerPlayer"."lastMatchAt" THEN EXCLUDED."team" ELSE "SoccerPlayer"."team" END,
        "lastMatchAt" = GREATEST(EXCLUDED."lastMatchAt", "SoccerPlayer"."lastMatchAt"),
        "updatedAt" = now()`;
    await prisma.soccerPlayerMatch.createMany({
      data: lines.map((l) => ({
        playerId: l.playerId,
        eventId: event.id,
        leagueId: event.leagueId,
        date: event.startsAt,
        team: l.team,
        opponent: l.opponent,
        isHome: l.isHome,
        starter: l.starter,
        minutes: l.minutes,
        goals: l.goals,
        assists: l.assists,
        shots: l.shots,
        shotsOnTarget: l.shotsOnTarget,
        saves: l.saves,
        yellowCards: l.yellowCards,
        redCards: l.redCards,
        fouls: l.fouls,
      })),
      skipDuplicates: true,
    });
  }
  await prisma.sportEvent.update({ where: { id: event.id }, data: { boxScoreAt: new Date() } });
}

export interface SoccerStatsSummary {
  matches: number;
  players: number;
  left: number;
}

/**
 * Reads box scores for finished ESPN soccer matches not yet read, newest first,
 * `concurrency` at a time, until `deadline` (ms epoch) or `max` matches.
 */
export async function ingestSoccerPlayerStats({ max = 400, deadline, days = 400, concurrency = 6 }: { max?: number; deadline: number; days?: number; concurrency?: number }): Promise<SoccerStatsSummary> {
  const where = {
    id: { startsWith: "espn:" },
    status: "final",
    boxScoreAt: null,
    startsAt: { gte: new Date(Date.now() - days * 86_400_000) },
    league: { sport: "soccer", espnPath: { not: null } },
  };
  const events = await prisma.sportEvent.findMany({
    where,
    orderBy: { startsAt: "desc" },
    take: max,
    select: { id: true, leagueId: true, startsAt: true, league: { select: { espnPath: true } } },
  });
  const out: SoccerStatsSummary = { matches: 0, players: 0, left: 0 };
  let next = 0;
  const worker = async () => {
    while (next < events.length && Date.now() < deadline) {
      const ev = events[next++]!;
      try {
        const res = await fetch(`${BASE}/${ev.league.espnPath}/summary?event=${ev.id.slice(5)}`, { headers: { Accept: "application/json" } });
        // A missing match (404) or an empty body never gets a box score: mark it read with none.
        if (!res.ok && res.status !== 404) continue;
        const text = res.ok ? await res.text() : "";
        let body: EspnSoccerSummary = {};
        try {
          body = text ? (JSON.parse(text) as EspnSoccerSummary) : {};
        } catch {
          body = {};
        }
        const lines = parseSoccerSummary(body);
        await storeMatch(ev, lines);
        out.matches++;
        out.players += lines.length;
      } catch {
        // One bad match never stops the run; it's retried next time.
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  out.left = await prisma.sportEvent.count({ where });
  return out;
}

/**
 * Wikipedia photos for players who've played lately and have no ESPN headshot,
 * a few at a time and spaced out (Wikipedia rate-limits bursts), until `deadline`.
 */
export async function warmSoccerPhotos(deadline: number, max = 12): Promise<number> {
  const { wikipediaPlayerPhoto } = await import("@/lib/allSports/logos");
  const players = await prisma.soccerPlayer.findMany({
    where: { headshotUrl: null, photoCheckedAt: null, lastMatchAt: { gte: new Date(Date.now() - 21 * 86_400_000) } },
    orderBy: { lastMatchAt: "desc" },
    take: max,
    select: { id: true, name: true },
  });
  let found = 0;
  for (const p of players) {
    if (Date.now() > deadline) break;
    const url = await wikipediaPlayerPhoto(p.name, /footballer|soccer|football/i, "footballer").catch(() => undefined);
    if (url === undefined) break; // rate-limited: stop for this run
    await prisma.soccerPlayer.update({ where: { id: p.id }, data: { photoUrl: url, photoCheckedAt: new Date() } });
    if (url) found++;
    await new Promise((r) => setTimeout(r, 700));
  }
  return found;
}
