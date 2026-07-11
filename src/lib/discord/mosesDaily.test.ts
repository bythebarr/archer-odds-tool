import { describe, it, expect } from "vitest";
import {
  renderMorningDrop,
  renderTeachingDrop,
  lessonForDate,
  dayIndex,
  TEACHABLE,
  type MorningData,
} from "./mosesDaily";
import type { UfcCard } from "./ufcBestPlays";

const NO_UFC = null;

function morning(over: Partial<MorningData>): MorningData {
  return {
    dateEt: "2026-07-11",
    mlbGames: 12,
    firstPitch: new Date("2026-07-11T17:05:00Z"), // 1:05 PM ET
    lastPitch: new Date("2026-07-12T02:10:00Z"), // 10:10 PM ET
    ufc: NO_UFC,
    ...over,
  };
}

describe("renderMorningDrop", () => {
  it("leads with the game count and the first/last pitch window", () => {
    const e = renderMorningDrop(morning({}));
    expect(e.title).toBe("☀️ Good morning — Jul 11");
    expect(e.description).toContain("**12 MLB games**");
    expect(e.description).toContain("First pitch **1:05 PM**");
    expect(e.description).toContain("last one **10:10 PM**");
    expect(e.description).toContain("drops at **1 PM ET**");
  });

  it("singularizes one game and collapses the window when first === last", () => {
    const only = new Date("2026-07-11T17:05:00Z");
    const e = renderMorningDrop(morning({ mlbGames: 1, firstPitch: only, lastPitch: only }));
    expect(e.description).toContain("**1 MLB game**");
    expect(e.description).toContain("First pitch **1:05 PM**");
    expect(e.description).not.toContain("last one");
  });

  it("handles an empty board without inventing a slate", () => {
    const e = renderMorningDrop(morning({ mlbGames: 0, firstPitch: null, lastPitch: null }));
    expect(e.description).toContain("Light board today");
    expect(e.description).not.toContain("First pitch"); // no invented pitch window
    expect(e.description).not.toContain("1 PM ET"); // no card promise on a dead board
  });

  it("adds the fight-week line when a UFC card is imminent — even on an empty MLB board", () => {
    const ufc = { eventTitle: "UFC 330", eventDate: new Date("2026-07-18T23:00:00Z"), plays: [] } as UfcCard;
    expect(renderMorningDrop(morning({ ufc })).description).toContain("🥊 **Fight week:** UFC 330");
    expect(renderMorningDrop(morning({ mlbGames: 0, firstPitch: null, lastPitch: null, ufc })).description).toContain(
      "🥊 **Fight week:** UFC 330"
    );
  });
});

describe("Moses 101 rotation", () => {
  it("is deterministic for a given day", () => {
    expect(lessonForDate("2026-07-11").id).toBe(lessonForDate("2026-07-11").id);
  });

  it("repeats exactly one TEACHABLE cycle apart, and advances between", () => {
    const base = "2026-07-11";
    const idx = dayIndex(base);
    const oneCycle = new Date((idx + TEACHABLE.length) * 86_400_000).toISOString().slice(0, 10);
    expect(lessonForDate(oneCycle).id).toBe(lessonForDate(base).id);
    // Consecutive days move to a different lesson (TEACHABLE has many entries).
    const nextDay = new Date((idx + 1) * 86_400_000).toISOString().slice(0, 10);
    expect(lessonForDate(nextDay).id).not.toBe(lessonForDate(base).id);
  });

  it("never teaches an app-navigation ('getting-around') term", () => {
    expect(TEACHABLE.length).toBeGreaterThan(0);
    expect(TEACHABLE.every((e) => e.category !== "getting-around")).toBe(true);
  });
});

describe("renderTeachingDrop", () => {
  it("titles with the term and includes the short definition", () => {
    const e = renderTeachingDrop({ id: "ev", term: "EV", short: "Is the price in your favor.", category: "value" });
    expect(e.title).toBe("📚 Moses 101 — EV");
    expect(e.description).toContain("Is the price in your favor.");
    expect(e.description).toContain("A new lesson every morning");
  });

  it("appends the long form only when present", () => {
    const withLong = renderTeachingDrop({ id: "x", term: "X", short: "Short.", long: "Extra nuance.", category: "value" });
    expect(withLong.description).toContain("Extra nuance.");
    const noLong = renderTeachingDrop({ id: "y", term: "Y", short: "Short.", category: "value" });
    expect(noLong.description).not.toContain("Extra nuance.");
  });
});
