import { describe, it, expect } from "vitest";
import { firstStart, cardTiming, cardDropTime, resultsTiming, LEAD_HOURS } from "./schedule";
import type { Play } from "@/lib/engine";

/**
 * The posting clock. These predicates decide whether the room speaks today, so
 * the failure modes worth pinning are: posting twice, posting a partial record,
 * and — the quiet one — silently skipping a day because a tick was missed.
 */

function play(startUtc: string, over: Partial<Play> = {}): Play {
  return {
    sportKey: "mlb",
    playKey: `k-${startUtc}`,
    eventRef: "g1",
    postedForDate: "2026-07-20",
    startUtc: new Date(startUtc),
    selection: { market: null, kind: "ml", side: "home", point: null, label: "Yankees ML" },
    bestPrice: -120,
    bestBookName: "FanDuel",
    marketEv: 0.03,
    modelEv: 0.06,
    suggestedUnits: 1,
    ...over,
  };
}

describe("firstStart", () => {
  it("finds the earliest start regardless of order or sport", () => {
    const plays = [
      play("2026-07-20T23:05:00Z"),
      play("2026-07-20T17:00:00Z", { sportKey: "tennis" }),
      play("2026-07-21T02:00:00Z", { sportKey: "ufc" }),
    ];
    expect(firstStart(plays)).toEqual(new Date("2026-07-20T17:00:00Z"));
  });

  it("is null on an empty board", () => {
    expect(firstStart([])).toBeNull();
  });
});

describe("cardTiming", () => {
  const plays = [play("2026-07-20T23:05:00Z")]; // drop at 20:05Z with a 3h lead

  it("holds until the lead window opens", () => {
    expect(cardTiming(new Date("2026-07-20T19:59:00Z"), plays, false)).toEqual({
      post: false,
      reason: "too-early",
    });
  });

  it("fires exactly at the lead boundary", () => {
    expect(cardTiming(new Date("2026-07-20T20:05:00Z"), plays, false)).toEqual({ post: true });
  });

  it("still fires LATE rather than skipping a missed day", () => {
    // A missed tick (deploy, outage) must not silently cost the room a card.
    expect(cardTiming(new Date("2026-07-20T22:30:00Z"), plays, false)).toEqual({ post: true });
  });

  it("never posts twice for the same date", () => {
    expect(cardTiming(new Date("2026-07-20T22:00:00Z"), plays, true)).toEqual({
      post: false,
      reason: "already-posted",
    });
  });

  it("says nothing on a board with no plays", () => {
    expect(cardTiming(new Date("2026-07-20T20:00:00Z"), [], false)).toEqual({
      post: false,
      reason: "no-plays",
    });
  });

  it("lets an early non-baseball event pull the whole card earlier", () => {
    // A 1pm ET tennis match (17:00Z) drops the card at 10am ET, not 10:30 by habit.
    const mixed = [play("2026-07-20T23:05:00Z"), play("2026-07-20T17:00:00Z", { sportKey: "tennis" })];
    expect(cardTiming(new Date("2026-07-20T14:05:00Z"), mixed, false)).toEqual({ post: true });
    expect(cardTiming(new Date("2026-07-20T13:55:00Z"), mixed, false)).toEqual({
      post: false,
      reason: "too-early",
    });
  });
});

describe("cardDropTime", () => {
  it("is LEAD_HOURS before the first start", () => {
    const t = cardDropTime([play("2026-07-20T23:05:00Z")]);
    expect(t).toEqual(new Date(new Date("2026-07-20T23:05:00Z").getTime() - LEAD_HOURS * 3600_000));
  });

  it("is null with nothing scheduled", () => {
    expect(cardDropTime([])).toBeNull();
  });
});

describe("resultsTiming", () => {
  const graded = { gradedAt: new Date("2026-07-21T03:00:00Z") };
  const pending = { gradedAt: null };

  it("waits while any play is still running", () => {
    expect(resultsTiming([graded, pending], false)).toEqual({
      post: false,
      reason: "still-pending",
      pending: 1,
    });
  });

  it("posts once everything has settled", () => {
    expect(resultsTiming([graded, graded], false)).toEqual({ post: true });
  });

  it("counts voided plays as settled so they can't hold the recap hostage", () => {
    // A voided play carries gradedAt — an unsupported sport must not block the recap.
    expect(resultsTiming([graded, { gradedAt: new Date() }], false)).toEqual({ post: true });
  });

  it("never posts twice for the same date", () => {
    expect(resultsTiming([graded], true)).toEqual({ post: false, reason: "already-posted" });
  });

  it("stays quiet on a day with no tracked plays", () => {
    expect(resultsTiming([], false)).toEqual({ post: false, reason: "no-plays" });
  });
});
