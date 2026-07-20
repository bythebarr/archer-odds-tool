/**
 * UFC adapter (Phase 2) — the contract's real stress test. UFC is the most
 * different sport we have: its own table family (UfcEvent/UfcBout/UfcFighter),
 * a fighter-math MODEL priced against a moneyline feed (no market-devig lens),
 * no props (The Odds API carries no MMA props), and out-of-band settlement (fight
 * nights finish after the morning recap). All of that weirdness is sealed inside
 * this adapter; from the outside it produces the same normalized `Play` as MLB.
 *
 * Like the MLB adapter, this re-implements nothing — it wraps getUfcBestPlays
 * (fighter-math + odds), the shared Kelly sizing, gradeUfcMoneyline, and the Cito
 * ingest. See docs/architecture/sport-engine.md. Once both this and MLB fit one
 * contract, the board/ledger/grader/nav can derive from the registry (Phase 3).
 */
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { getUfcBestPlays, type UfcBestPlay } from "@/lib/discord/ufcBestPlays";
import { getUfcMatchupAsOf } from "@/lib/queries/ufcMatchup";
import { computeUfcWinProbability } from "@/lib/ufc/fighterMath";
import type { CalibrationSample } from "../calibration";
import { unitsFor } from "@/lib/betting/kelly";
import { ufcPlayLine, prettyEventDate } from "@/lib/card/line";
import { gradeUfcMoneyline } from "@/lib/discord/gradePlay";
import { ensureUfcOddsFresh } from "@/lib/ufc/refreshOddsOnView";
import { syncRecentUfcEvents, backfillUpcomingUfcEvents } from "@/lib/ufc/backfillUfc";
import { sportMetaByKey } from "../sportsMeta";
import type {
  IngestSummary,
  MarketSpec,
  Play,
  PlayGrade,
  SportAdapter,
  SportModel,
} from "../types";

/** UFC offers moneyline only — no spreads/totals, and The Odds API has no MMA props. */
const UFC_MARKETS: MarketSpec[] = [{ market: "h2h", kind: "ml", label: "Moneyline" }];

/**
 * Lookahead-safe backtest sampler for the fighter-math model (Phase 4a). For each
 * settled bout with usable stats, rebuild the projection using ONLY fight history
 * that predates the bout (getUfcMatchupAsOf) and record the model favorite's
 * probability vs. whether that favorite actually won. This is the collect() the
 * old scripts/backtest-ufc-calibration.ts inlined, now behind the contract so the
 * shared harness scores it identically to every other sport.
 */
async function collectUfcSamples({ limit }: { limit: number }): Promise<CalibrationSample[]> {
  const bouts = await prisma.ufcBout.findMany({
    where: { status: "completed", winnerFighterId: { not: null }, event: { hasStats: true } },
    select: {
      redCornerFighterId: true,
      blueCornerFighterId: true,
      winnerFighterId: true,
      event: { select: { eventDate: true } },
    },
    orderBy: { event: { eventDate: "desc" } }, // newest first (for the time split)
    take: limit,
  });

  const samples: CalibrationSample[] = [];
  for (const b of bouts) {
    const matchup = await getUfcMatchupAsOf(
      b.redCornerFighterId,
      b.blueCornerFighterId,
      b.event.eventDate
    );
    if (!matchup) continue;
    const proj = computeUfcWinProbability(matchup, b.event.eventDate);
    if (proj.fighterAProb === null || proj.fighterBProb === null) continue;
    const redFav = proj.fighterAProb >= proj.fighterBProb;
    samples.push({
      pred: redFav ? proj.fighterAProb : proj.fighterBProb,
      won: b.winnerFighterId === (redFav ? b.redCornerFighterId : b.blueCornerFighterId) ? 1 : 0,
    });
  }
  return samples;
}

/** UFC's fighter-math model; metadata only (pricing lives in getUfcBestPlays). */
const UFC_MODEL: SportModel = {
  describes: "fighter-math win probability + finish projection (method × round)",
  backtest: { unit: "priceable bout", collect: collectUfcSamples },
  // From `npm run backtest:ufc` — a thin but real edge (skill just past no-skill).
  // Refresh as the sample grows; it sits close to the trusted/marginal line.
  calibration: {
    verdict: "trusted",
    brier: 0.2403,
    baseRateBrier: 0.2425,
    n: 1227,
    asOf: "2026-07-16",
  },
};

/**
 * Map one fighter-math best play onto the normalized `Play`. Pure, and exactly
 * the values recordUfcPostedPlays persists (postCard.ts): playKey
 * `ufc:${boutId}:${side}`, market h2h / kind ml, side = the backed corner,
 * modelEv = archerEv, units = unitsFor(archerEv, price), postedForDate = the
 * fight's ET date. Kept exported so the parity test can assert it field-for-field.
 *
 * UFC carries NO market-lens EV — the model prob vs the moneyline IS the edge —
 * so `marketEv` is null. The fighter-math extras (finish lean, title marker) ride
 * on `display.line` (pre-rendered in the fighter-math voice), and the event title
 * + date on `display.sectionLabel`, so the board keeps UFC's red Fight-Night
 * section without a UFC branch (sport-engine Phase 3, board rewrite).
 */
export function ufcToPlay(p: UfcBestPlay, eventDate: Date, eventTitle: string): Play {
  return {
    sportKey: "ufc",
    // Recorded under the FIGHT'S ET date, so it settles the day after the bout no
    // matter how many days early we tease the card (mirrors recordUfcPostedPlays).
    postedForDate: etDateOf(eventDate),
    playKey: `ufc:${p.boutId}:${p.side}`,
    eventRef: p.boutId,
    startUtc: eventDate, // no per-bout start time; the event date stands in
    selection: { market: "h2h", kind: "ml", side: p.side, point: null, label: p.pickName },
    bestPrice: p.bestPrice,
    bestBookName: p.bestBookName,
    marketEv: null, // UFC has no market-devig lens — the model vs the price is the edge
    modelEv: p.archerEv,
    suggestedUnits: unitsFor(p.archerEv, p.bestPrice),
    display: {
      href: "/ufc",
      backed: null,
      playerName: p.pickName,
      // The fighter-math voice (finish lean, title marker) rides on the line, so
      // the board keeps UFC's red Fight-Night section with no UFC branch. The
      // section title's dynamic half is the event + date.
      line: ufcPlayLine(p),
      sectionLabel: `${eventTitle} · ${prettyEventDate(eventDate)}`,
    },
  };
}

/**
 * The fighter-math +EV plays on the next imminent UFC card. UFC selection is not
 * date-scoped — getUfcBestPlays always returns the single next event within its
 * lookahead — so `dateEt` is accepted for the contract but not used to filter,
 * exactly as the poster appends the UFC section to every daily card until the
 * event passes. Reads stored odds; freshness (ensureUfcOddsFresh) is an upstream
 * concern, the same posture as MLB's odds poll living outside listPlays.
 *
 * Takes no date param (UFC isn't date-scoped); still satisfies the contract's
 * `listPlays(dateEt)` — a narrower implementation is assignable.
 */
async function listPlays(): Promise<Play[]> {
  const card = await getUfcBestPlays();
  if (!card) return [];
  return card.plays.map((p) => ufcToPlay(p, card.eventDate, card.eventTitle));
}

/**
 * Poke the gated UFC odds poll before the board lists plays — moved here from the
 * poster so the board's freshness step is registry-driven (no UFC branch). Gated
 * by a shared PollLog window, so it stays ~2 credits per staleness window no
 * matter how many callers fire it; failures are the board's to swallow.
 */
async function refresh(): Promise<void> {
  await ensureUfcOddsFresh();
}

/**
 * Grade one tracked UFC play against its bout — the exact logic of
 * postResults.gradeUfcPlay: no bout row → void, fight not `completed` →
 * `"pending"` (fight nights finish late; a later pass settles it), else the
 * moneyline grade against the winner (a draw/no-contest is a push, never a loss).
 */
async function grade(play: Play): Promise<PlayGrade> {
  const bout = await prisma.ufcBout.findUnique({
    where: { id: play.eventRef },
    select: {
      status: true,
      winnerFighterId: true,
      redCornerFighterId: true,
      blueCornerFighterId: true,
    },
  });
  if (!bout) return "void";
  if (bout.status !== "completed") return "pending"; // not fought yet — leave pending
  return gradeUfcMoneyline(
    play.selection.side,
    bout.redCornerFighterId,
    bout.blueCornerFighterId,
    bout.winnerFighterId
  );
}

/**
 * Pull UFC's own data — Cito recent (settled) + upcoming events. Ingest is data
 * pull only; settling finished fights is the grader's job (routed through the
 * registry now), so the batch settle the backfill-ufc cron also runs stays a
 * separate step — keeping the engine free of any dependency on the Discord/grader
 * layer. UFC ingest is whole-feed incremental, so `dateEt` is unused (the impl
 * takes no param but satisfies `ingest(dateEt)`); odds refresh on-view.
 */
async function ingest(): Promise<IngestSummary> {
  const recent = await syncRecentUfcEvents();
  const upcoming = await backfillUpcomingUfcEvents();
  return {
    sportKey: "ufc",
    ok: true,
    detail: `${recent.eventsProcessed + upcoming.eventsProcessed} events`,
    recent,
    upcoming,
  };
}

export const ufcAdapter = {
  key: "ufc",
  meta: sportMetaByKey.ufc,
  model: UFC_MODEL,
  markets: UFC_MARKETS,
  ingest,
  refresh,
  listPlays,
  grade,
} satisfies SportAdapter;
