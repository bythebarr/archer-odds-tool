/**
 * The handpick layer — the owner's daily selections, between the engine and the
 * poster.
 *
 * The system finds far more +EV plays than anyone should fire at in a day, so
 * the product splits in two (owner's 2026-07-20 spec):
 *
 *   • #ev-slate    — every play the engine surfaced. No units. NEVER recorded,
 *                    so it can't move a record nobody staked.
 *   • #todays-card — the plays he ticked in the deck. Units. THE record.
 *   • #free-play   — exactly one ticked play, posted free, on its own record.
 *
 * Selections are intent, not outcome: he ticks and un-ticks all morning while
 * prices move, and nothing is recorded until the poster fires and writes the
 * price that actually went out. That's why this is its own table rather than
 * early PostedPlay rows.
 */
import { prisma } from "@/lib/prisma";
import type { PlayStream } from "@/generated/prisma/client";
import type { Play } from "@/lib/engine";

export type { PlayStream };

/** A day's picks, as the deck and the poster both want them: keyed by playKey. */
/** One ticked play: which ledger it rides, and the owner's stake if he set one. */
export interface Pick {
  stream: PlayStream;
  /** Null → fall back to the model's suggested (quarter-Kelly) stake. */
  units: number | null;
}

export interface DaySelection {
  /** playKey → pick, for every ticked play. */
  byKey: Map<string, Pick>;
  /** The single free play's key, or null when he hasn't chosen one. */
  freeKey: string | null;
  cardCount: number;
}

export async function getSelection(dateEt: string): Promise<DaySelection> {
  const rows = await prisma.cardSelection.findMany({ where: { dateEt } });
  const byKey = new Map<string, Pick>(rows.map((r) => [r.playKey, { stream: r.stream, units: r.units }]));
  const free = rows.find((r) => r.stream === "free");
  return {
    byKey,
    freeKey: free?.playKey ?? null,
    cardCount: rows.filter((r) => r.stream === "card").length,
  };
}

/**
 * Tick/un-tick one play. `stream: null` clears it.
 *
 * There is exactly ONE free play a day, so promoting a play to `free` demotes
 * whatever held it. Doing that here — rather than trusting the UI to send a
 * clean pair of writes — means the invariant survives a double-tap, a stale
 * tab, or two devices open at once. Runs in a transaction for the same reason.
 */
export async function setSelection(
  dateEt: string,
  playKey: string,
  stream: PlayStream | null
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (stream === null) {
      await tx.cardSelection.deleteMany({ where: { dateEt, playKey } });
      return;
    }
    if (stream === "free") {
      // Demote the incumbent free play (if any) rather than ending up with two.
      await tx.cardSelection.updateMany({
        where: { dateEt, stream: "free", playKey: { not: playKey } },
        data: { stream: "card" },
      });
    }
    await tx.cardSelection.upsert({
      where: { dateEt_playKey: { dateEt, playKey } },
      // Deliberately does NOT touch units: re-tapping Card/Free must not silently
      // discard a stake he already set.
      update: { stream },
      create: { dateEt, playKey, stream },
    });
  });
}

/**
 * Set (or clear, with null) the stake on an already-ticked play. A no-op on a
 * play that isn't picked — units without a pick would be a stake on nothing.
 */
export async function setUnits(dateEt: string, playKey: string, units: number | null): Promise<void> {
  await prisma.cardSelection.updateMany({ where: { dateEt, playKey }, data: { units } });
}

/** Wipe a day's picks — the deck's "start over". */
export async function clearSelection(dateEt: string): Promise<void> {
  await prisma.cardSelection.deleteMany({ where: { dateEt } });
}

/**
 * Split the day's live plays into what posts where.
 *
 * Matching is by playKey against plays pulled fresh at post time, so a selection
 * whose play has vanished (line pulled, event scratched, odds gone stale out of
 * the pool) simply doesn't post — it's reported in `missing` instead of going
 * out at a price that no longer exists.
 */
export interface SplitPlays {
  /** Handpicked, with units — #todays-card. */
  card: Play[];
  /** The one free play — #free-play. */
  free: Play | null;
  /** Everything he didn't pick — #ev-slate, no units, not recorded. */
  slate: Play[];
  /** Selected playKeys with no live play left. */
  missing: string[];
}

export function splitBySelection(plays: Play[], selection: DaySelection): SplitPlays {
  const byKey = new Map(plays.map((p) => [p.playKey, p]));
  const card: Play[] = [];
  let free: Play | null = null;
  const missing: string[] = [];

  for (const [key, pick] of selection.byKey) {
    const live = byKey.get(key);
    if (!live) {
      missing.push(key);
      continue;
    }
    // Resolve the stake once, here, so everything downstream — the posted line,
    // the ledger row, the units total in the intro — reads the same number.
    const play: Play = pick.units === null ? live : { ...live, suggestedUnits: pick.units };
    if (pick.stream === "free") free = play;
    else card.push(play);
  }

  // Preserve the engine's ordering within the card rather than selection order,
  // so the posted card reads the same way the deck showed it.
  const order = new Map(plays.map((p, i) => [p.playKey, i]));
  card.sort((a, b) => (order.get(a.playKey) ?? 0) - (order.get(b.playKey) ?? 0));

  const picked = new Set(selection.byKey.keys());
  return { card, free, slate: plays.filter((p) => !picked.has(p.playKey)), missing };
}
