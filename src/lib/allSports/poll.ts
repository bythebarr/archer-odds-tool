/**
 * The all-sports poller. One call does what's due, in this order:
 *
 *   1. catalog   — which leagues are in season (every 6 hours; free on TOA)
 *   2. schedules — each league's upcoming events (every 30 minutes; free on TOA)
 *   3. odds      — leagues whose cadence says they're due (cadence.ts), soonest first
 *   4. results   — leagues with games that should have finished (every 2 hours)
 *
 * It stops starting new work past `maxMs`, so a cron invocation never times
 * out; whatever's left is due again on the next call.
 */
import { prisma } from "@/lib/prisma";
import type { AllSportsFeed, FeedEvent, FeedLeague, FeedLine } from "./feed";
import { activeFeeds, type ActiveFeed } from "./feeds";
import { budgetStretch, isDue } from "./cadence";
import { leagueInfo, titleFromSlug } from "./leagueDirectory";

const CATALOG_EVERY_MIN = 6 * 60;
const SCHEDULE_EVERY_MIN = 30;
const RESULTS_EVERY_MIN = 120;
const DISCOVERY_EVERY_MIN = 6 * 60;

export const leagueId = (l: FeedLeague) => `${l.ref.sport}/${l.ref.slug}`;
export const eventKey = (feed: string, id: string) => `${feed}:${id}`;

async function lastRun(job: string): Promise<Date | null> {
  return (await prisma.pollLog.findUnique({ where: { jobName: job } }))?.lastPolledAt ?? null;
}
async function markRun(job: string, status: string, creditsUsed?: number, creditsRemaining?: number | null) {
  const data = { lastPolledAt: new Date(), lastStatus: status.slice(0, 500), creditsUsed: creditsUsed ?? null, creditsRemaining: creditsRemaining ?? null };
  await prisma.pollLog.upsert({ where: { jobName: job }, create: { jobName: job, ...data }, update: data });
}
const minutesSince = (d: Date | null, now: Date) => (d ? (now.getTime() - d.getTime()) / 60_000 : Infinity);

/** This month's spend for a feed, kept as a running total in PollLog. */
async function monthSpend(feed: string, now: Date): Promise<{ job: string; spent: number }> {
  const job = `all-sports-spend-${feed}-${now.toISOString().slice(0, 7)}`;
  return { job, spent: (await prisma.pollLog.findUnique({ where: { jobName: job } }))?.creditsUsed ?? 0 };
}

export async function syncCatalog(active: ActiveFeed, now: Date): Promise<number> {
  const leagues = (await active.feed.listLeagues()).filter((l) => !active.sports || active.sports(l.ref.sport));
  for (const l of leagues) {
    const id = leagueId(l);
    const info = leagueInfo(id);
    const name = info?.name ?? (l.title || titleFromSlug(l.ref.slug));
    await prisma.league.upsert({
      where: { id },
      create: { id, sport: l.ref.sport, name, region: info?.region ?? l.region, provider: active.feed.id, providerKey: l.providerKey, outright: l.outright, espnPath: info?.espn ?? null, rank: info?.rank ?? 1000, lastSyncedAt: now },
      update: { name, region: info?.region ?? l.region, provider: active.feed.id, providerKey: l.providerKey, outright: l.outright, espnPath: info?.espn ?? null, rank: info?.rank ?? 1000, active: true, lastSyncedAt: now },
    });
  }
  // Out of season: off the board until the feed lists it again.
  await prisma.league.updateMany({ where: { provider: active.feed.id, lastSyncedAt: { lt: now } }, data: { active: false } });
  return leagues.length;
}

async function upsertEvents(feed: string, leagueIdOf: Map<string, string>, events: FeedEvent[]) {
  for (const e of events) {
    const lid = leagueIdOf.get(e.providerKey);
    if (!lid) continue;
    const id = eventKey(feed, e.id);
    const results = e.status === "final" || e.status === "live"
      ? { homeScore: e.homeScore ?? null, awayScore: e.awayScore ?? null, periods: e.periods ?? undefined }
      : {};
    await prisma.sportEvent.upsert({
      where: { id },
      create: { id, leagueId: lid, startsAt: e.startsAt, home: e.home, away: e.away, homeRef: e.homeRef ?? null, awayRef: e.awayRef ?? null, status: e.status, ...results },
      update: { startsAt: e.startsAt, home: e.home, away: e.away, homeRef: e.homeRef ?? undefined, awayRef: e.awayRef ?? undefined, status: e.status, ...results },
    });
  }
}

export async function refreshSchedules(active: ActiveFeed, now: Date): Promise<number> {
  const rows = await prisma.league.findMany({ where: { provider: active.feed.id, active: true } });
  const leagues = rows.map(toFeedLeague);
  const byLeague = await active.feed.listEvents(leagues);
  const idOf = new Map(rows.map((r) => [r.providerKey, r.id]));
  let n = 0;
  for (const r of rows) {
    const upcoming = (byLeague.get(r.providerKey) ?? []).filter((e) => e.status !== "final" && e.status !== "cancelled");
    await upsertEvents(active.feed.id, idOf, upcoming);
    n += upcoming.length;
    const next = upcoming.filter((e) => e.startsAt.getTime() > now.getTime() - 3 * 3_600_000).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
    await prisma.league.update({ where: { id: r.id }, data: { nextEventAt: next?.startsAt ?? null, upcomingCount: upcoming.length } });
  }
  return n;
}

function toFeedLeague(r: { providerKey: string; sport: string; id: string; name: string; region: string | null; outright: boolean }): FeedLeague {
  return { providerKey: r.providerKey, ref: { sport: r.sport, slug: r.id.slice(r.sport.length + 1) }, title: r.name, region: r.region, outright: r.outright };
}

/** Replaces each polled event's lines with what the books hang now. */
export async function storeLines(feed: string, leagueIdOf: Map<string, string>, events: FeedEvent[], lines: FeedLine[], polledAt: Date) {
  await upsertEvents(feed, leagueIdOf, events);
  const byEvent = new Map<string, FeedLine[]>();
  for (const l of lines) byEvent.set(l.eventId, [...(byEvent.get(l.eventId) ?? []), l]);
  for (const e of events) {
    const id = eventKey(feed, e.id);
    // Last write wins on a duplicate key (a book repeating a line).
    const unique = new Map<string, FeedLine>();
    for (const l of byEvent.get(e.id) ?? []) unique.set(`${l.bookKey}|${l.market}|${l.period}|${l.side}|${l.point}`, l);
    await prisma.$transaction([
      prisma.sportEventLine.deleteMany({ where: { eventId: id } }),
      prisma.sportEventLine.createMany({
        data: [...unique.values()].map((l) => ({ eventId: id, bookKey: l.bookKey, market: l.market, period: l.period, side: l.side, point: l.point, priceAmerican: l.priceAmerican, polledAt })),
      }),
      prisma.sportEvent.update({ where: { id }, data: { lastOddsAt: polledAt } }),
    ]);
  }
}

export interface AllSportsSummary {
  feeds: string[];
  leaguesCataloged: number;
  eventsScheduled: number;
  leaguesPolled: string[];
  linesStored: number;
  resultsStored: number;
  spent: Record<string, number>;
  stretch: Record<string, number>;
  failures: string[];
}

/** Monthly budget per feed in its own unit (credits on TOA, requests on odds-api.io). */
function monthlyBudget(feed: string): number {
  const env = feed === "toa" ? process.env.ALL_SPORTS_TOA_BUDGET : process.env.ALL_SPORTS_IO_BUDGET;
  const n = Number(env);
  // Defaults: a third of a 5M-credit TOA plan (the deep pipelines and props use the rest);
  // most of an odds-api.io plan's 5,000 requests an hour.
  return Number.isFinite(n) && n > 0 ? n : feed === "toa" ? 1_500_000 : 3_000_000;
}

export async function pollAllSports({ now = new Date(), maxMs = 50_000, feeds = activeFeeds() }: { now?: Date; maxMs?: number; feeds?: ActiveFeed[] } = {}): Promise<AllSportsSummary> {
  const started = Date.now();
  const timeLeft = () => maxMs - (Date.now() - started);
  const s: AllSportsSummary = { feeds: feeds.map((f) => f.feed.id), leaguesCataloged: 0, eventsScheduled: 0, leaguesPolled: [], linesStored: 0, resultsStored: 0, spent: {}, stretch: {}, failures: [] };

  for (const active of feeds) {
    const feed: AllSportsFeed = active.feed;
    const tag = (job: string) => `all-sports-${job}-${feed.id}`;
    try {
      if (minutesSince(await lastRun(tag("catalog")), now) >= CATALOG_EVERY_MIN) {
        s.leaguesCataloged = await syncCatalog(active, now);
        await markRun(tag("catalog"), `ok: ${s.leaguesCataloged} leagues`);
      }
      if (minutesSince(await lastRun(tag("schedules")), now) >= SCHEDULE_EVERY_MIN) {
        s.eventsScheduled = await refreshSchedules(active, now);
        await markRun(tag("schedules"), `ok: ${s.eventsScheduled} events`);
      }
    } catch (error) {
      s.failures.push(`${feed.id} catalog/schedules: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
    }

    const { job: spendJob, spent: spentBefore } = await monthSpend(feed.id, now);
    const stretch = budgetStretch(spentBefore, monthlyBudget(feed.id), now);
    s.stretch[feed.id] = Math.round(stretch * 100) / 100;
    let spent = 0;
    let remaining: number | null = null;

    // The deep pipelines (NBA, NFL, props) share The Odds API account: below the reserve, every
    // other sport waits so they never run dry. The latest remaining count any job saw is the read.
    if (feed.id === "toa") {
      const latest = await prisma.pollLog.findFirst({ where: { creditsRemaining: { not: null } }, orderBy: { lastPolledAt: "desc" } });
      const reserve = Number(process.env.ALL_SPORTS_RESERVE ?? 20_000);
      if (latest?.creditsRemaining !== null && latest?.creditsRemaining !== undefined && latest.creditsRemaining < reserve) {
        s.failures.push(`toa: ${latest.creditsRemaining} credits left, under the ${reserve} reserve — other sports paused`);
        continue;
      }
    }

    const leagues = await prisma.league.findMany({ where: { provider: feed.id, active: true }, orderBy: [{ nextEventAt: "asc" }] });
    const idOf = new Map(leagues.map((l) => [l.providerKey, l.id]));
    for (const l of leagues) {
      if (timeLeft() < 5_000) break;
      // A league with no known schedule (the feed's free events list was empty or unavailable) is
      // still checked every few hours — the odds call itself says what's on.
      const discovery = !l.outright && !l.nextEventAt && minutesSince(l.lastPolledAt, now) >= DISCOVERY_EVERY_MIN * stretch;
      if (!discovery && !isDue({ nextEventAt: l.nextEventAt, lastPolledAt: l.lastPolledAt, outright: l.outright }, now, stretch)) continue;
      try {
        const upcoming = await prisma.sportEvent.findMany({
          where: { leagueId: l.id, status: { in: ["scheduled", "live"] }, startsAt: { gte: new Date(now.getTime() - 3 * 3_600_000), lte: new Date(now.getTime() + 14 * 86_400_000) } },
          select: { id: true },
        });
        const ids = upcoming.map((e) => e.id.slice(feed.id.length + 1));
        if (!l.outright && ids.length === 0 && !(discovery && feed.id === "toa")) {
          await prisma.league.update({ where: { id: l.id }, data: { lastPolledAt: now } });
          continue;
        }
        const res = await feed.fetchOdds(toFeedLeague(l), ids);
        spent += res.cost;
        remaining = res.remaining ?? remaining;
        await storeLines(feed.id, idOf, res.events, res.lines, now);
        const next = res.events.filter((e) => e.startsAt.getTime() > now.getTime() - 3 * 3_600_000).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
        await prisma.league.update({
          where: { id: l.id },
          data: { lastPolledAt: now, ...(l.outright ? { nextEventAt: res.events[0]?.startsAt ?? l.nextEventAt, upcomingCount: res.events.length } : next ? { nextEventAt: next.startsAt, upcomingCount: Math.max(l.upcomingCount, res.events.length) } : {}) },
        });
        s.leaguesPolled.push(l.id);
        s.linesStored += res.lines.length;
      } catch (error) {
        s.failures.push(`${l.id}: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
        await prisma.league.update({ where: { id: l.id }, data: { lastPolledAt: now } });
      }
    }

    // Results: leagues with a game that started 2.5+ hours ago and isn't final yet.
    if (timeLeft() > 5_000 && minutesSince(await lastRun(tag("results")), now) >= RESULTS_EVERY_MIN) {
      const pending = await prisma.sportEvent.findMany({
        where: { status: { in: ["scheduled", "live"] }, startsAt: { lte: new Date(now.getTime() - 2.5 * 3_600_000), gte: new Date(now.getTime() - 3 * 86_400_000) }, league: { provider: feed.id, outright: false } },
        select: { leagueId: true },
        distinct: ["leagueId"],
      });
      for (const { leagueId: lid } of pending) {
        if (timeLeft() < 5_000) break;
        const l = leagues.find((x) => x.id === lid);
        if (!l) continue;
        try {
          const res = await feed.fetchResults(toFeedLeague(l));
          spent += res.cost;
          await upsertEvents(feed.id, idOf, res.events);
          s.resultsStored += res.events.filter((e) => e.status === "final").length;
        } catch (error) {
          s.failures.push(`${lid} results: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
        }
      }
      await markRun(tag("results"), `ok: ${s.resultsStored} results`);
    }

    s.spent[feed.id] = spent;
    await markRun(spendJob, "month spend", spentBefore + spent, remaining);
    await markRun(tag("odds"), `ok: ${s.leaguesPolled.length} leagues, ${s.linesStored} lines`, spent, remaining);
  }
  return s;
}
