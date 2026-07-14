import { describe, it, expect } from "vitest";
import { getAdapter, postedPlayToPlay } from "./index";
import type { PostedPlay } from "@/generated/prisma/client";

/**
 * Phase 3a: grading now dispatches through the registry. These cover the two
 * pure pieces the refactor rests on — the sport→adapter lookup (an unregistered
 * sport must resolve to undefined so gradePending voids it, exactly as
 * tennis/soccer were voided before) and the PostedPlay→Play rehydration grade
 * consumes. The per-sport grade logic itself is covered by the adapter tests.
 */

describe("getAdapter (grading dispatch lookup)", () => {
  it("resolves the registered sports", () => {
    expect(getAdapter("mlb")?.key).toBe("mlb");
    expect(getAdapter("ufc")?.key).toBe("ufc");
  });

  it("returns undefined for unregistered sports (the void path)", () => {
    // tennis/soccer have no adapter yet → gradePending voids them, as it always did.
    expect(getAdapter("tennis")).toBeUndefined();
    expect(getAdapter("soccer")).toBeUndefined();
    expect(getAdapter("nfl")).toBeUndefined();
  });
});

function postedPlay(over: Partial<PostedPlay> = {}): PostedPlay {
  return {
    id: "pp1",
    postedForDate: "2026-07-14",
    playKey: "g1:totals:over:8.5",
    sport: "mlb",
    matchId: "g1",
    market: "totals",
    kind: "total",
    side: "over",
    point: 8.5,
    selectionLabel: "Over 8.5",
    bestPrice: -110,
    bestBookName: "FanDuel",
    ev: 0.061,
    units: 1.5,
    mlbPlayerId: null,
    statCategory: null,
    result: null,
    voided: false,
    gradedAt: null,
    createdAt: new Date("2026-07-14T15:00:00Z"),
    ...over,
  } as unknown as PostedPlay;
}

describe("postedPlayToPlay (rehydrate a posted row for grade)", () => {
  it("carries the identity + selection grade reads", () => {
    const out = postedPlayToPlay(postedPlay());
    expect(out).toMatchObject({
      sportKey: "mlb",
      playKey: "g1:totals:over:8.5",
      eventRef: "g1", // matchId → eventRef, what grade looks the game up by
      postedForDate: "2026-07-14",
      selection: { market: "totals", kind: "total", side: "over", point: 8.5, label: "Over 8.5" },
      modelEv: 0.061, // stored ev → modelEv
      suggestedUnits: 1.5, // stored units
    });
  });

  it("preserves a UFC row's corner + bout ref for the moneyline grade", () => {
    const out = postedPlayToPlay(
      postedPlay({ sport: "ufc", playKey: "ufc:bout1:red", matchId: "bout1", market: "h2h", kind: "ml", side: "red", point: null })
    );
    expect(out.eventRef).toBe("bout1");
    expect(out.selection.side).toBe("red");
    expect(out.sportKey).toBe("ufc");
  });
});
