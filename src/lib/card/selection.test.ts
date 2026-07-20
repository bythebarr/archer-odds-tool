import { describe, it, expect } from "vitest";
import { splitBySelection, type DaySelection, type PlayStream } from "./selection";
import type { Play } from "@/lib/engine";

/**
 * splitBySelection decides what posts where — the card that carries units and
 * the record, the one free play, and the unstaked slate. A bug here either
 * leaks an unpicked play onto the tracked record or drops a pick he made, so
 * the routing is pinned here rather than left to the poster's integration path.
 */

function play(over: Partial<Play> = {}): Play {
  return {
    sportKey: "mlb",
    playKey: "k1",
    eventRef: "g1",
    postedForDate: "2026-07-20",
    startUtc: new Date("2026-07-20T23:05:00Z"),
    selection: { market: null, kind: "ml", side: "home", point: null, label: "Yankees ML" },
    bestPrice: -120,
    bestBookName: "FanDuel",
    marketEv: 0.03,
    modelEv: 0.06,
    suggestedUnits: 1,
    ...over,
  };
}

function selection(entries: Array<[string, PlayStream, number?]>): DaySelection {
  const byKey = new Map(entries.map(([k, stream, units]) => [k, { stream, units: units ?? null }]));
  const free = entries.find(([, s]) => s === "free");
  return {
    byKey,
    freeKey: free?.[0] ?? null,
    cardCount: entries.filter(([, s]) => s === "card").length,
  };
}

describe("splitBySelection", () => {
  const a = play({ playKey: "a" });
  const b = play({ playKey: "b" });
  const c = play({ playKey: "c" });

  it("routes ticked plays to the card, one to free, and the rest to the slate", () => {
    const out = splitBySelection([a, b, c], selection([["a", "card"], ["b", "free"]]));
    expect(out.card.map((p) => p.playKey)).toEqual(["a"]);
    expect(out.free?.playKey).toBe("b");
    expect(out.slate.map((p) => p.playKey)).toEqual(["c"]);
    expect(out.missing).toEqual([]);
  });

  it("with nothing ticked, everything is slate and no card posts", () => {
    const out = splitBySelection([a, b, c], selection([]));
    expect(out.card).toEqual([]);
    expect(out.free).toBeNull();
    expect(out.slate).toHaveLength(3);
  });

  it("never leaks a picked play into the slate (it would be unstaked but recorded)", () => {
    const out = splitBySelection([a, b, c], selection([["a", "card"], ["b", "free"]]));
    const slateKeys = out.slate.map((p) => p.playKey);
    expect(slateKeys).not.toContain("a");
    expect(slateKeys).not.toContain("b");
  });

  it("reports picks whose play went away instead of posting a stale price", () => {
    // "b" was ticked this morning; its line has since been pulled from the pool.
    const out = splitBySelection([a, c], selection([["a", "card"], ["b", "card"]]));
    expect(out.card.map((p) => p.playKey)).toEqual(["a"]);
    expect(out.missing).toEqual(["b"]);
  });

  it("keeps the card in engine order, not the order he ticked them", () => {
    // Ticked c first, then a — the posted card should still read a, c.
    const out = splitBySelection([a, b, c], selection([["c", "card"], ["a", "card"]]));
    expect(out.card.map((p) => p.playKey)).toEqual(["a", "c"]);
  });

  it("a missing free pick leaves free null rather than promoting someone else", () => {
    const out = splitBySelection([a, c], selection([["b", "free"], ["a", "card"]]));
    expect(out.free).toBeNull();
    expect(out.missing).toEqual(["b"]);
  });
});

describe("manual unit sizing", () => {
  const a = play({ playKey: "a", suggestedUnits: 1 });

  it("uses the owner's stake when he set one", () => {
    const out = splitBySelection([a], selection([["a", "card", 3]]));
    expect(out.card[0].suggestedUnits).toBe(3);
  });

  it("falls back to the model's suggestion when he didn't", () => {
    const out = splitBySelection([a], selection([["a", "card"]]));
    expect(out.card[0].suggestedUnits).toBe(1);
  });

  it("applies to the free play too", () => {
    const out = splitBySelection([a], selection([["a", "free", 2.5]]));
    expect(out.free?.suggestedUnits).toBe(2.5);
  });

  it("does not mutate the play the engine handed us", () => {
    // The override must be a copy — mutating would corrupt the same object in
    // the slate list and in any other view holding it.
    splitBySelection([a], selection([["a", "card", 3]]));
    expect(a.suggestedUnits).toBe(1);
  });
});
