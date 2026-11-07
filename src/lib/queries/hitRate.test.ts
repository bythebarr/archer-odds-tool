import { describe, expect, it } from "vitest";
import { groupByTeam, reduceHitRate } from "./hitRate";
import type { OutcomeResult } from "@/generated/prisma/client";

/** The pure reducers under getTeamHitRates(Batch) (Phase 2 E: first tests for this module). */
const rows = (results: OutcomeResult[]) => results.map((result) => ({ result }));

describe("reduceHitRate", () => {
  it("slices to the window before counting", () => {
    const out = reduceHitRate(rows(["hit", "hit", "miss", "hit", "hit"]), 3, false);
    expect(out).toMatchObject({ gamesFound: 3, hits: 2, misses: 1, hitRate: 2 / 3, record: "2-1" });
  });
  it("pushes don't count as decided, and show in the record", () => {
    const out = reduceHitRate(rows(["hit", "push", "miss"]), 10, false);
    expect(out).toMatchObject({ hits: 1, misses: 1, pushes: 1, hitRate: 0.5, record: "1-1-1" });
  });
  it("flip mirrors hits and misses for the Under side of a total", () => {
    const out = reduceHitRate(rows(["hit", "miss", "push"]), 10, true);
    expect(out).toMatchObject({ hits: 1, misses: 1, pushes: 1 });
  });
  it("no decided games: null rate, honest record", () => {
    expect(reduceHitRate(rows(["push"]), 10, false).hitRate).toBeNull();
    expect(reduceHitRate([], 10, false)).toMatchObject({ gamesFound: 0, record: "0-0" });
  });
});

describe("groupByTeam", () => {
  it("groups in order and skips the schema's null-teamId (tennis) rows", () => {
    const input = [
      { teamId: "a", v: 1 },
      { teamId: null, v: 2 },
      { teamId: "a", v: 3 },
      { teamId: "b", v: 4 },
    ];
    const by = groupByTeam(input);
    expect(by.get("a")?.map((r) => r.v)).toEqual([1, 3]);
    expect(by.get("b")?.map((r) => r.v)).toEqual([4]);
    expect(by.size).toBe(2);
  });
});
