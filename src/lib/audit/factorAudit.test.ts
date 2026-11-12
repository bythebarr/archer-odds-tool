import { describe, expect, it } from "vitest";
import { MIN_PER_HALF, TAGS, auditFactors, cellStats, splitByDate, type AuditSample } from "./factorAudit";

function rng(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/**
 * Two kinds of bet: "good" where ARCHR's 60% is the truth and the books say 52%,
 * "bad" where ARCHR says 60% but the books' 45% was right. Dated across 60 days.
 */
function world(n: number, seed = 5): AuditSample[] {
  const rnd = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const good = i % 2 === 0;
    const truth = good ? 0.6 : 0.45;
    return {
      p: 0.6,
      market: good ? 0.52 : 0.45,
      price: -110,
      won: (rnd() < truth ? 1 : 0) as 0 | 1,
      date: `2026-10-${String(1 + (i % 30)).padStart(2, "0")}`,
      tags: { kind: good ? "good" : "bad" },
    };
  });
}

describe("auditFactors", () => {
  it("finds the factor value where ARCHR beats the books, and the one where it doesn't", () => {
    const a = auditFactors(world(1200));
    const good = a.cells.find((c) => c.value === "good")!;
    const bad = a.cells.find((c) => c.value === "bad")!;
    expect(good.verdict).toBe("helps");
    expect(good.all.skill!).toBeGreaterThan(0);
    expect(bad.verdict).toBe("hurts");
    expect(bad.all.bias).toBeGreaterThan(0.1);
    expect(bad.all.skill!).toBeLessThan(0);
  });

  it("won't judge a cell thinner than the per-half minimum", () => {
    const a = auditFactors(world(MIN_PER_HALF * 2));
    expect(a.cells.every((c) => c.verdict === "too few")).toBe(true);
  });

  it("splits by date, earlier half first", () => {
    const [e, l] = splitByDate(world(10));
    expect(e.length).toBe(5);
    expect(e.every((x) => l.every((y) => x.date <= y.date))).toBe(true);
  });

  it("cell stats: bias, skill against the market, ROI on ARCHR's edge bets", () => {
    const rows: AuditSample[] = [
      { p: 0.7, market: 0.5, price: 100, won: 1, date: "2026-10-01", tags: {} },
      { p: 0.7, market: 0.5, price: 100, won: 0, date: "2026-10-02", tags: {} },
      { p: 0.4, market: 0.5, price: 100, won: 0, date: "2026-10-03", tags: {} },
    ];
    const c = cellStats(rows);
    expect(c.bias).toBeCloseTo((0.7 + 0.7 + 0.4) / 3 - 1 / 3);
    expect(c.edgeBets).toBe(2);
    expect(c.roi).toBeCloseTo(0); // +1 and −1
  });
});

describe("TAGS", () => {
  it("cuts the gap, price, record and history the same way for every sport", () => {
    expect(TAGS.gap(0.7, 0.5)).toBe("ARCHR 15+ pts above books");
    expect(TAGS.gap(0.5, 0.51)).toBe("ARCHR within 3 pts of books");
    expect(TAGS.gap(0.5, null)).toBeUndefined();
    expect(TAGS.price(-250)).toBe("−200 or shorter");
    expect(TAGS.price(150)).toBe("+130 or longer");
    expect(TAGS.record(8, 10, 0.6, -110)).toBe("model likes it, record backs it");
    expect(TAGS.record(3, 10, 0.6, -110)).toBe("model likes it, record doesn't");
    expect(TAGS.record(9, 10, 0.45, -110)).toBe("hot record, model passes");
    expect(TAGS.sample(40)).toBe("30+ games");
  });
});
