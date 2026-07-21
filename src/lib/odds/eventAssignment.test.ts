import { describe, it, expect } from "vitest";
import { resolveClosestPairings } from "./ingest";

const HOUR = 3_600_000;

/** The 2026-07-21 WSH @ COL split doubleheader that corrupted the board. */
const GAME_1 = { id: "game-afternoon" }; // 18:40Z
const GAME_2 = { id: "game-evening" }; //   00:40Z, six hours later

describe("resolveClosestPairings — two games' prices can never merge into one row", () => {
  it("gives a doubleheader's two events their own two rows", () => {
    // Both events fall inside the other game's match window; only closeness
    // separates them. Event A is exact for game 1, event B exact for game 2.
    const assigned = resolveClosestPairings([
      { eventId: "evt-afternoon", game: GAME_1, deltaMs: 0 },
      { eventId: "evt-afternoon", game: GAME_2, deltaMs: 6 * HOUR },
      { eventId: "evt-evening", game: GAME_2, deltaMs: 0 },
      { eventId: "evt-evening", game: GAME_1, deltaMs: 6 * HOUR },
    ]);

    expect(assigned).toHaveLength(2);
    const byEvent = new Map(assigned.map((a) => [a.eventId, a.game.id]));
    expect(byEvent.get("evt-afternoon")).toBe("game-afternoon");
    expect(byEvent.get("evt-evening")).toBe("game-evening");
  });

  it("never assigns two events to the same game — the actual corruption", () => {
    // The old code took candidates[0] per event with no ordering, so BOTH
    // events could claim one row, merging a pick'em market with a -275 one.
    const assigned = resolveClosestPairings([
      { eventId: "evt-a", game: GAME_2, deltaMs: 6 * HOUR },
      { eventId: "evt-b", game: GAME_2, deltaMs: 2 * HOUR },
    ]);
    expect(assigned).toHaveLength(1);
    expect(assigned[0]!.eventId).toBe("evt-b"); // the closer one wins
  });

  it("never assigns one event to two games", () => {
    const assigned = resolveClosestPairings([
      { eventId: "evt-a", game: GAME_1, deltaMs: 1 * HOUR },
      { eventId: "evt-a", game: GAME_2, deltaMs: 2 * HOUR },
    ]);
    expect(assigned).toHaveLength(1);
    expect(assigned[0]!.game.id).toBe("game-afternoon");
  });

  it("settles the best pairing globally, not in feed order", () => {
    // A far-but-listed-first pairing must not win over an exact one that the
    // feed happens to list later. This is what `candidates[0]` got wrong.
    const assigned = resolveClosestPairings([
      { eventId: "evt-far", game: GAME_1, deltaMs: 5 * HOUR },
      { eventId: "evt-exact", game: GAME_1, deltaMs: 0 },
    ]);
    expect(assigned).toHaveLength(1);
    expect(assigned[0]!.eventId).toBe("evt-exact");
  });

  it("respects games already bound to an event on a previous poll", () => {
    const assigned = resolveClosestPairings(
      [{ eventId: "evt-new", game: GAME_1, deltaMs: 0 }],
      new Set(["game-afternoon"])
    );
    expect(assigned).toEqual([]);
  });

  it("is deterministic when two pairings tie exactly", () => {
    const pairs = [
      { eventId: "evt-b", game: { id: "g2" }, deltaMs: HOUR },
      { eventId: "evt-a", game: { id: "g1" }, deltaMs: HOUR },
    ];
    const first = resolveClosestPairings(pairs);
    const second = resolveClosestPairings([...pairs].reverse());
    expect(first).toEqual(second);
  });

  it("leaves an event unassigned rather than guessing when its game is taken", () => {
    // Dropping an event is recoverable — the next poll retries. Writing it onto
    // the wrong game corrupts the board silently, which is not.
    const assigned = resolveClosestPairings([
      { eventId: "evt-a", game: GAME_1, deltaMs: 0 },
      { eventId: "evt-b", game: GAME_1, deltaMs: HOUR },
    ]);
    expect(assigned.map((a) => a.eventId)).toEqual(["evt-a"]);
  });
});
