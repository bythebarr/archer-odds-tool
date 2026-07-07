import { prisma } from "@/lib/prisma";
import { etDayBoundsUtc } from "@/lib/dateEt";
import { listGames } from "./games";
import { getGameMatchupsBatch } from "./matchup";
import { computeArcherWinProbability } from "@/lib/archer/winProbability";
import { listUpcomingUfcEvents } from "./ufcEvents";

/**
 * The Slate: one normalized, cross-sport view of a day's card. Every sport
 * adapts its own row shape (MLB games, tennis/soccer matches, UFC bouts) into
 * a single `SlateItem`, so the board is one surface fed by many sports rather
 * than N bespoke pages. Adding a sport = adding an adapter here.
 *
 * PAID-EV SEAM: `SlateItem.ev` is intentionally null everywhere in v0 — we
 * don't yet have comprehensive live odds across every market (that's the paid
 * tier, turned on at launch). The board already renders an EV column/sort off
 * this field, so when paid odds land, populating `ev` in the adapters is the
 * ONLY change needed to light the whole thing up. Until then the board runs on
 * free signals: the Archer model probability (MLB) and, later, per-sport models.
 */

export type SlateSport = "mlb" | "tennis" | "soccer" | "ufc";
export const SLATE_SPORTS: readonly SlateSport[] = ["mlb", "tennis", "soccer", "ufc"] as const;

export interface SlateSide {
  name: string;
  /** Compact secondary label — abbreviation, record, seed, etc. */
  meta?: string | null;
}

/**
 * PAID-EV SEAM (see file header). Populated per-item from the best available
 * price vs. the model/consensus once paid odds exist; null in v0.
 */
export interface SlateEv {
  side: "home" | "away";
  /** Edge in percentage points, e.g. +4.2. */
  evPct: number;
  bookName: string;
  priceAmerican: number;
}

export interface SlateItem {
  /** Globally unique across sports (sport-prefixed), for React keys + filtering. */
  key: string;
  sport: SlateSport;
  startUtc: Date;
  status: string;
  href: string;
  /** Event/tournament/context label (e.g. a UFC event title); null for plain matchups. */
  title: string | null;
  home: SlateSide;
  away: SlateSide;
  /** Free model win-probability where we have one (MLB Archer today; more sports later). Null otherwise. */
  modelProb: { home: number | null; away: number | null } | null;
  /** PAID-EV SEAM — always null in v0. */
  ev: SlateEv | null;
}

export interface Slate {
  date: string;
  items: SlateItem[];
  counts: Record<SlateSport, number>;
}

/** MLB — the showcase sport: carries the free Archer win-probability model. */
async function mlbItems(dateEt: string): Promise<SlateItem[]> {
  const games = await listGames(dateEt);
  if (games.length === 0) return [];

  const matchups = await getGameMatchupsBatch(games.map((g) => g.id));

  return games.map((g) => {
    const matchup = matchups[g.id];
    const prob = matchup ? computeArcherWinProbability(matchup) : null;
    return {
      key: `mlb:${g.id}`,
      sport: "mlb" as const,
      startUtc: g.scheduledStartUtc,
      status: g.status,
      href: `/games/${g.id}`,
      title: null,
      home: { name: g.homeTeam.name, meta: g.homeTeam.abbreviation },
      away: { name: g.awayTeam.name, meta: g.awayTeam.abbreviation },
      modelProb: prob ? { home: prob.homeProb, away: prob.awayProb } : null,
      ev: null, // SEAM: paid EV
    };
  });
}

async function tennisItems(gte: Date, lt: Date): Promise<SlateItem[]> {
  const matches = await prisma.game.findMany({
    where: { sport: "tennis", scheduledStartUtc: { gte, lt } },
    orderBy: { scheduledStartUtc: "asc" },
    include: { homePlayer: true, awayPlayer: true },
  });

  return matches.map((m) => ({
    key: `tennis:${m.id}`,
    sport: "tennis" as const,
    startUtc: m.scheduledStartUtc,
    status: m.status,
    href: `/tennis/${m.id}`,
    title: null,
    home: { name: m.homePlayer?.name ?? "TBD" },
    away: { name: m.awayPlayer?.name ?? "TBD" },
    modelProb: null, // SEAM: a tennis model plugs in here
    ev: null, // SEAM: paid EV
  }));
}

async function soccerItems(gte: Date, lt: Date): Promise<SlateItem[]> {
  const matches = await prisma.game.findMany({
    where: { sport: "soccer", scheduledStartUtc: { gte, lt } },
    orderBy: { scheduledStartUtc: "asc" },
    include: { homeTeam: true, awayTeam: true },
  });

  return matches.map((m) => ({
    key: `soccer:${m.id}`,
    sport: "soccer" as const,
    startUtc: m.scheduledStartUtc,
    status: m.status,
    href: `/soccer/${m.id}`,
    title: null,
    home: { name: m.homeTeam?.name ?? "TBD", meta: m.homeTeam?.abbreviation },
    away: { name: m.awayTeam?.name ?? "TBD", meta: m.awayTeam?.abbreviation },
    modelProb: null, // SEAM: a soccer model plugs in here
    ev: null, // SEAM: paid EV
  }));
}

/**
 * UFC — event-based rather than a Game row, so it's matched by calendar date
 * (eventDate is date-only, so a plain UTC date-string compare is the right
 * granularity here). The fighter-math model is per-bout and computed on the
 * bout page; surfacing it board-level is a follow-up, hence modelProb stays
 * null for now.
 */
async function ufcItems(dateEt: string): Promise<SlateItem[]> {
  const events = await listUpcomingUfcEvents();
  const items: SlateItem[] = [];

  for (const event of events) {
    if (event.eventDate.toISOString().slice(0, 10) !== dateEt) continue;
    for (const bout of event.bouts) {
      items.push({
        key: `ufc:${bout.id}`,
        sport: "ufc",
        startUtc: event.eventDate,
        status: "scheduled",
        href: `/ufc/${bout.id}`,
        title: event.title,
        home: { name: bout.red.name, meta: bout.red.record },
        away: { name: bout.blue.name, meta: bout.blue.record },
        modelProb: null, // SEAM: board-level fighter-math plugs in here
        ev: null, // SEAM: paid EV
      });
    }
  }
  return items;
}

/**
 * The whole day's card across every sport, sorted by start time. Adapters run
 * in parallel; each is independent so one sport erroring/emptying doesn't sink
 * the others (they just contribute nothing).
 */
export async function getSlateForDate(dateEt: string): Promise<Slate> {
  const { gte, lt } = etDayBoundsUtc(dateEt);

  const [mlb, tennis, soccer, ufc] = await Promise.all([
    mlbItems(dateEt),
    tennisItems(gte, lt),
    soccerItems(gte, lt),
    ufcItems(dateEt),
  ]);

  const items = [...mlb, ...tennis, ...soccer, ...ufc].sort(
    (a, b) => a.startUtc.getTime() - b.startUtc.getTime()
  );

  return {
    date: dateEt,
    items,
    counts: { mlb: mlb.length, tennis: tennis.length, soccer: soccer.length, ufc: ufc.length },
  };
}
