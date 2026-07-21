import { describe, it, expect } from "vitest";
import { getAdapter, postedPlayToPlay } from "./index";
import type { PostedPlay } from "@/generated/prisma/client";

/**
 * Phase 3a/3d: grading dispatches through the registry. These cover the two
 * pure pieces the refactor rests on — the sport→adapter lookup and the
 * PostedPlay→Play rehydration grade consumes. Every sport with a page is now
 * registered (Phase 3d), so the "void path" is a truly-unregistered key; a
 * registered thin sport (tennis) resolves but grades to "void" (no plays yet).
 * The per-sport grade logic itself is covered by the adapter tests.
 */

describe("getAdapter (grading dispatch lookup)", () => {
  it("resolves every registered sport", () => {
    expect(getAdapter("mlb")?.key).toBe("mlb");
    expect(getAdapter("ufc")?.key).toBe("ufc");
    // Thin adapters (Phase 3d) — registered so nav/Slate derive from one list.
    expect(getAdapter("nfl")?.key).toBe("nfl");
    expect(getAdapter("tennis")?.key).toBe("tennis");
    expect(getAdapter("soccer")?.key).toBe("soccer");
    expect(getAdapter("f1")?.key).toBe("f1");
  });

  it("returns undefined for an unregistered sport (the void path)", () => {
    // Was "nfl" until NFL was actually registered. Use a sport we have no
    // provider coverage for at all, so this doesn't quietly become a live key again.
    expect(getAdapter("cricket")).toBeUndefined();
  });

  it("a thin sport resolves but grades to void (no tracked plays yet)", async () => {
    // soccer is still a thin market-only adapter (tennis now grades for real via
    // its GameOutcome store, so it's no longer the void-grade example).
    const soccer = getAdapter("soccer");
    expect(soccer).toBeDefined();
    await expect(soccer!.grade({} as never)).resolves.toBe("void");
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
