import { describe, expect, it } from "vitest";
import { PRICE_FLOOR, comboGrid, evaluate, pickStats, splitDate, stable, walkForward, type SweepRow } from "./filterSweep";
import type { ScreenerProp } from "@/lib/screener/types";

const prop = (over: Partial<ScreenerProp>): ScreenerProp => ({
  id: "x",
  sport: "nba",
  league: "NBA",
  gameId: "nba:1",
  game: "",
  startsAt: "",
  team: "",
  opponent: "",
  player: "",
  stat: "points",
  statLabel: "PTS",
  side: "over",
  point: 20.5,
  main: true,
  priceAmerican: -110,
  bookName: null,
  archr: 0.6,
  edge: 0.15,
  rates: { l3: [2, 3], l5: [4, 5], l10: [7, 10], l15: [9, 15], szn: [7, 10], last: [0, 0] },
  ...over,
});

const row = (date: string, won: 0 | 1, over: Partial<ScreenerProp> = {}): SweepRow => ({ prop: prop(over), won, date });

describe("filter sweep", () => {
  it("scores hit rate and flat-stake ROI at the price", () => {
    const s = pickStats([row("2026-11-01", 1, { priceAmerican: 100 }), row("2026-11-01", 0, { priceAmerican: 100 }), row("2026-11-01", 1, { priceAmerican: 100 })]);
    expect(s.n).toBe(3);
    expect(s.hitRate).toBeCloseTo(2 / 3);
    expect(s.roi).toBeCloseTo(1 / 3);
    expect(pickStats([]).roi).toBeNull();
  });

  it("splits by slate day, not by row count", () => {
    expect(splitDate([{ date: "2026-11-01" }, { date: "2026-11-01" }, { date: "2026-11-01" }, { date: "2026-11-02" }])).toBe("2026-11-01");
  });

  it("puts the −200 floor on every combination and runs the screener's own filters", () => {
    const grid = comboGrid({ minutes: false });
    expect(grid.every((c) => c.filters.shortest === PRICE_FLOOR && c.filters.mainOnly)).toBe(true);
    expect(comboGrid({ minutes: true }).length).toBe(grid.length * 3);
    const rows = [row("2026-11-01", 1, { priceAmerican: -250 }), row("2026-11-01", 1, { priceAmerican: -150 })];
    const open = evaluate(rows, [grid[0]!])[0]!;
    expect(open.all.n).toBe(1); // the −250 never passes
  });

  it("keeps a combination as held-up only when both halves pay, and walks forward on the earlier half", () => {
    const rows: SweepRow[] = [];
    for (let d = 1; d <= 4; d++)
      for (let i = 0; i < 60; i++) {
        rows.push(row(`2026-11-0${d}`, i % 5 < 3 ? 1 : 0, { side: "over" })); // 60% at +100
        rows.push(row(`2026-11-0${d}`, d <= 2 ? (i % 5 < 3 ? 1 : 0) : i % 5 < 1 ? 1 : 0, { side: "under" })); // fades late
      }
    const all = rows.map((r) => ({ ...r, prop: { ...r.prop, priceAmerican: 100 } }));
    const grid = comboGrid({ minutes: false }).filter((c) => c.label.startsWith("no record bar · price −200 to any") || /^no record bar · (over|under)s only · price −200 to any$/.test(c.label));
    const results = evaluate(all, grid);
    const held = stable(results).map((r) => r.combo.label);
    expect(held).toContain("no record bar · overs only · price −200 to any");
    expect(held).not.toContain("no record bar · unders only · price −200 to any");
    const wf = walkForward(results);
    expect(wf.picked.length).toBe(results.length);
    expect(wf.heldUp).toBeLessThan(wf.picked.length);
  });
});
