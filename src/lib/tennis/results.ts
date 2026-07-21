/**
 * Tennis results sync + grading — the piece that turns tennis from `signalOnly`
 * into a tracked, settleable sport.
 *
 * Reads ESPN's free tennis scoreboard (see espnScoreboard.ts), writes the set
 * line and a final status onto our Game rows, and records the h2h GameOutcome
 * rows the tennis adapter's `grade()` already reads. Nothing else has to change:
 * the grader was written against those rows and has been returning "pending"
 * only because nothing ever wrote them.
 *
 * Two things this deliberately does NOT do:
 *
 *  - It does not join on any provider id. ParlayAPI's ids don't even agree
 *    between its own endpoints (that's what silently zeroed props for a day), and
 *    ESPN's are a different namespace again. Players' NAMES are the join key.
 *  - It does not go through `gradeGame`. That grader keys GameOutcome by teamId
 *    and settles spreads/totals off closing lines; a tennis match has players,
 *    not teams, and our feed carries h2h only. Reusing it would mean writing
 *    team-keyed rows the tennis grader can't read.
 */
import { prisma } from "@/lib/prisma";
import { etDateOf, etDayBoundsUtc } from "@/lib/dateEt";
import { normalizeName } from "./archive";
import { fetchTennisScoreboard, type EspnTennisResult } from "./espnScoreboard";

export interface SyncTennisResultsSummary {
  datesChecked: string[];
  /**
   * OUR tennis matches that should have settled by now and hadn't when the run
   * started. This, not the ESPN result count, is the "was there work to do"
   * number the poll status is judged on: ESPN reports hundreds of qualifiers we
   * never priced, so counting those would report an error every single day we
   * simply had no tennis on the board.
   */
  awaitingResults: number;
  /** Completed singles matches ESPN reported on those ET dates. */
  resultsFetched: number;
  matchesFinalized: number;
  matchesGraded: number;
  /** Completed results we couldn't tie to a Game row — named, so drift is debuggable. */
  unmatched: string[];
}

/**
 * How far back to look each run. Tennis runs from ~09:00 UTC in Europe to past
 * midnight UTC in North America, so a match can land on either side of an ET day
 * boundary from the one its odds were dated to; three days is wide enough that a
 * missed cron tick or a rain-delayed finish still gets picked up. Cheap because
 * ESPN is free — the reason this isn't the single-day check a credit-metered
 * provider would force.
 */
const LOOKBACK_DAYS = 3;

/** The ET dates to check, today first. */
export function lookbackDatesEt(today: Date, days: number = LOOKBACK_DAYS): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    out.push(etDateOf(new Date(today.getTime() - i * 86_400_000)));
  }
  return out;
}

/** The subset of a tennis Game this matcher needs — keeps it testable without Prisma. */
export interface MatchableTennisGame {
  id: string;
  homeName: string;
  awayName: string;
  scheduledStartUtc: Date;
}

export interface TennisMatchHit {
  game: MatchableTennisGame;
  /** True when ESPN's home player is our away player — orientation is not guaranteed to agree. */
  flipped: boolean;
}

/**
 * Loose key for one player: first initial + last token. The fallback pass, for
 * when a feed abbreviates a first name ("F. Auger-Aliassime") or spells a
 * compound surname differently. Weak on its own, which is why it's only ever
 * used to match a whole PAIR of players — two people sharing a surname AND an
 * initial AND an opponent on the same day is not a real scenario.
 */
function looseKey(name: string): string {
  const parts = normalizeName(name).split(" ").filter(Boolean);
  if (parts.length === 0) return "";
  return `${parts[0][0]}|${parts[parts.length - 1]}`;
}

/** Unordered pair key, so a home/away disagreement between sources can't cause a miss. */
function pairKey(a: string, b: string, key: (n: string) => string): string {
  return [key(a), key(b)].sort().join("~");
}

/**
 * Finds the Game a completed ESPN result refers to.
 *
 * Exact normalized names first, then the loose initial+surname pass. When the
 * same pair appears more than once in the candidate window — a rematch across
 * two tournaments, or the same match dated differently by the two sources — the
 * closest scheduled start wins, mirroring how the props matcher breaks a
 * doubleheader tie. Returns null rather than guessing: a match bound to the
 * wrong Game produces a graded record that lies.
 */
export function matchTennisResult(
  result: EspnTennisResult,
  candidates: MatchableTennisGame[]
): TennisMatchHit | null {
  for (const key of [normalizeName, looseKey]) {
    const wanted = pairKey(result.homeName, result.awayName, key);
    const hits = candidates.filter((g) => pairKey(g.homeName, g.awayName, key) === wanted);
    if (hits.length === 0) continue;

    const game = hits.reduce((best, g) =>
      Math.abs(g.scheduledStartUtc.getTime() - result.startUtc.getTime()) <
      Math.abs(best.scheduledStartUtc.getTime() - result.startUtc.getTime())
        ? g
        : best
    );
    return { game, flipped: key(game.homeName) !== key(result.homeName) };
  }
  return null;
}

/**
 * Tennis Game rows whose start sits within a day either side of `dateEt`.
 *
 * A day either side, not the exact ET day the NFL sync uses, because the odds
 * feed's `commence_time` is not trustworthy to the hour — it has been observed
 * 6h early for anything at or after 00:00 UTC, which is enough to file a late
 * European match under the wrong ET date. Widening the window is safe here in a
 * way it wouldn't be for teams: the match still has to be the same PAIR of
 * players, and the same two players don't meet twice inside three days.
 */
async function candidateGamesForDate(dateEt: string): Promise<MatchableTennisGame[]> {
  const { gte } = etDayBoundsUtc(dateEt);
  const games = await prisma.game.findMany({
    where: {
      sport: "tennis",
      scheduledStartUtc: {
        gte: new Date(gte.getTime() - 86_400_000),
        lt: new Date(gte.getTime() + 2 * 86_400_000),
      },
    },
    select: {
      id: true,
      scheduledStartUtc: true,
      homePlayer: { select: { name: true } },
      awayPlayer: { select: { name: true } },
    },
  });

  return games
    .filter((g) => g.homePlayer && g.awayPlayer)
    .map((g) => ({
      id: g.id,
      homeName: g.homePlayer!.name,
      awayName: g.awayPlayer!.name,
      scheduledStartUtc: g.scheduledStartUtc,
    }));
}

/**
 * A tennis match runs ~2-3 hours; five gives room for a rain delay or a fifth
 * set before we'd call an unsettled match overdue. Anything younger than this
 * that hasn't graded is still in progress, not stranded.
 */
const SETTLE_GRACE_MS = 5 * 3_600_000;

/** Our own matches that are overdue a result — the denominator for the run's status. */
async function countAwaitingResults(datesChecked: string[], now: Date): Promise<number> {
  const oldest = etDayBoundsUtc(datesChecked[datesChecked.length - 1]).gte;
  return prisma.game.count({
    where: {
      sport: "tennis",
      status: { not: "final" },
      scheduledStartUtc: { gte: oldest, lt: new Date(now.getTime() - SETTLE_GRACE_MS) },
    },
  });
}

async function upsertPlayerOutcome(gameId: string, playerId: string, result: "hit" | "miss" | "push") {
  await prisma.gameOutcome.upsert({
    where: { gameId_playerId_marketType: { gameId, playerId, marketType: "h2h" } },
    create: { gameId, playerId, marketType: "h2h", result },
    update: { result },
  });
}

/**
 * Pulls recent tennis results, finalizes the matching matches, and grades them.
 * Idempotent: re-running rewrites the same values rather than double-counting,
 * because both the score write and the outcome writes are upserts.
 */
export async function syncAndGradeTennisResults(
  now: Date = new Date()
): Promise<SyncTennisResultsSummary> {
  const datesChecked = lookbackDatesEt(now);
  const unmatched: string[] = [];
  let resultsFetched = 0;
  let matchesFinalized = 0;
  let matchesGraded = 0;
  const gradedGameIds = new Set<string>();
  const awaitingResults = await countAwaitingResults(datesChecked, now);

  for (const dateEt of datesChecked) {
    // ESPN returns the whole tournament for any date inside it, so the day
    // filter has to happen here — `?dates` picks the tournament, not the day.
    const all = await fetchTennisScoreboard(dateEt);
    const results = all.filter((r) => r.completed && etDateOf(r.startUtc) === dateEt);
    resultsFetched += results.length;
    if (results.length === 0) continue;

    const candidates = await candidateGamesForDate(dateEt);

    for (const result of results) {
      const hit = matchTennisResult(result, candidates);
      if (!hit) {
        // Not one of ours is the norm — we only store matches the odds feed
        // priced, and ESPN carries every qualifier and challenger. Naming them
        // anyway keeps real name drift visible instead of silent.
        unmatched.push(`${result.awayName} vs ${result.homeName} (${etDateOf(result.startUtc)})`);
        continue;
      }
      // A later ET date's pass can re-encounter the same match; grading it twice
      // is harmless but would inflate the count the status line is judged on.
      if (gradedGameIds.has(hit.game.id)) continue;

      const game = await prisma.game.findUnique({
        where: { id: hit.game.id },
        select: { status: true, homeScore: true, awayScore: true, homePlayerId: true, awayPlayerId: true },
      });
      if (!game?.homePlayerId || !game.awayPlayerId) continue;

      // Our orientation, not ESPN's: the odds we priced are keyed to our home/away.
      const ourHomeWon = hit.flipped ? !result.homeWon : result.homeWon;
      const ourHomeSets = hit.flipped ? result.awaySets : result.homeSets;
      const ourAwaySets = hit.flipped ? result.homeSets : result.awaySets;

      if (
        game.status !== "final" ||
        game.homeScore !== ourHomeSets ||
        game.awayScore !== ourAwaySets
      ) {
        await prisma.game.update({
          where: { id: hit.game.id },
          data: { status: "final", homeScore: ourHomeSets, awayScore: ourAwaySets },
        });
        matchesFinalized++;
      }

      // A walkover was never played, so the books refund it — push both sides
      // rather than paying a winner who never took the court. Still finalized:
      // leaving it pending is what pins a day's results recap open forever.
      if (result.walkover) {
        await upsertPlayerOutcome(hit.game.id, game.homePlayerId, "push");
        await upsertPlayerOutcome(hit.game.id, game.awayPlayerId, "push");
      } else {
        await upsertPlayerOutcome(hit.game.id, game.homePlayerId, ourHomeWon ? "hit" : "miss");
        await upsertPlayerOutcome(hit.game.id, game.awayPlayerId, ourHomeWon ? "miss" : "hit");
      }

      gradedGameIds.add(hit.game.id);
      matchesGraded++;
    }
  }

  return { datesChecked, awaitingResults, resultsFetched, matchesFinalized, matchesGraded, unmatched };
}
