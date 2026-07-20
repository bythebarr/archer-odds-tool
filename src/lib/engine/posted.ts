/**
 * Bridge from persistence (`PostedPlay`) back to the engine's `Play` — the
 * inverse of the adapters' listPlays→toPlay direction. The grader stores plays
 * as PostedPlay rows and later settles them; to dispatch settlement through the
 * registry (`getAdapter(sportKey).grade`), it rehydrates each row into a Play.
 *
 * `grade` only reads identity + selection (sportKey, playKey, eventRef, and the
 * SelectionSpec), so the pricing/display fields are filled from what the row
 * stored and are never load-bearing here. `startUtc` isn't persisted on a
 * PostedPlay; `createdAt` (when we posted it) stands in and is likewise unread.
 */
import type { PostedPlay } from "@/generated/prisma/client";
import type { MarketKind } from "@/lib/queries/oddsPool";
import type { Play } from "./types";

export function postedPlayToPlay(p: PostedPlay): Play {
  return {
    sportKey: p.sport,
    playKey: p.playKey,
    eventRef: p.matchId,
    postedForDate: p.postedForDate,
    startUtc: p.createdAt, // not persisted per-play; unread by grade
    selection: {
      market: p.market,
      kind: p.kind as MarketKind,
      side: p.side,
      point: p.point,
      label: p.selectionLabel,
    },
    bestPrice: p.bestPrice,
    bestBookName: p.bestBookName,
    marketEv: null, // not stored distinctly; grade doesn't read it
    modelEv: p.ev, // the model EV we posted on
    suggestedUnits: p.units,
    display: {},
  };
}
