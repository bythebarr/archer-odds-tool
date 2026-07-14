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
import { unitsFor } from "@/lib/betting/kelly";
import { gradeUfcMoneyline } from "@/lib/discord/gradePlay";
import { settlePendingUfcPlays } from "@/lib/discord/postResults";
import { syncRecentUfcEvents, backfillUpcomingUfcEvents } from "@/lib/ufc/backfillUfc";
import { SPORT_META } from "@/lib/sports";
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

/** UFC's fighter-math model; metadata only (pricing lives in getUfcBestPlays). */
const UFC_MODEL: SportModel = {
  describes: "fighter-math win probability + finish projection (method × round)",
};

/**
 * Map one fighter-math best play onto the normalized `Play`. Pure, and exactly
 * the values recordUfcPostedPlays persists (postCard.ts): playKey
 * `ufc:${boutId}:${side}`, market h2h / kind ml, side = the backed corner,
 * modelEv = archerEv, units = unitsFor(archerEv, price), postedForDate = the
 * fight's ET date. Kept exported so the parity test can assert it field-for-field.
 *
 * UFC carries NO market-lens EV — the model prob vs the moneyline IS the edge —
 * so `marketEv` is null. The fighter-math extras (prob, finishLean, weightClass)
 * are analyst-voice display that the fixed PlayDisplay doesn't yet carry; the UFC
 * embed still renders them directly until the board rewrite (Phase 3) decides how
 * PlayDisplay carries sport-specific extras.
 */
export function ufcToPlay(p: UfcBestPlay, eventDate: Date): Play {
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
    display: { href: "/ufc", backed: null, playerName: p.pickName },
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
  return card.plays.map((p) => ufcToPlay(p, card.eventDate));
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
 * Pull UFC's own data — Cito recent (settled) + upcoming events, then settle any
 * bouts now final. Mirrors the backfill-ufc cron exactly (settlement is
 * best-effort there and here). UFC ingest is whole-feed incremental, so `dateEt`
 * is unused; odds are refreshed on-view (ensureUfcOddsFresh), outside this path.
 * Takes no date param (whole-feed incremental) but satisfies `ingest(dateEt)`.
 */
async function ingest(): Promise<IngestSummary> {
  const recent = await syncRecentUfcEvents();
  const upcoming = await backfillUpcomingUfcEvents();
  let settled = 0;
  try {
    settled = await settlePendingUfcPlays();
  } catch {
    // Best-effort, mirrors the cron: a settle failure can't fail the sync.
  }
  return {
    sportKey: "ufc",
    ok: true,
    detail: `${recent.eventsProcessed + upcoming.eventsProcessed} events, ${settled} settled`,
    recent,
    upcoming,
    settled,
  };
}

export const ufcAdapter: SportAdapter = {
  key: "ufc",
  meta: SPORT_META.ufc,
  model: UFC_MODEL,
  markets: UFC_MARKETS,
  ingest,
  listPlays,
  grade,
};
