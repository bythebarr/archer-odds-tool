import { describe, expect, it } from "vitest";
import { CANDIDATE_RULE, STALE_MINUTES, VALIDATED_RULES, bookPairs, consensusExcluding, markCandidates, minutesReliability, screenOrder, valueRows, type ValueInput, type ValueQuote } from "./marketValue";

const now = new Date("2026-11-17T22:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);
const q = (bookKey: string, side: "over" | "under", priceAmerican: number, age = 20): ValueQuote => ({ bookKey, bookName: bookKey, side, priceAmerican, polledAt: ago(age) });
const input = (over: Partial<ValueInput> = {}): ValueInput => ({
  id: "g|p|points",
  playerId: "p",
  player: "P",
  team: "BOS",
  opponent: "NYK",
  gameId: "g",
  startsAt: "2026-11-18T00:00:00Z",
  stat: "points",
  statLabel: "PTS",
  point: 20.5,
  quotes: [q("draftkings", "over", 130), q("draftkings", "under", -160)],
  rawOver: 0.5,
  s2Over: 0.5,
  v2Over: 0.5,
  v2Z: 0.2,
  minutes: 32,
  minutesScale: 4,
  injury: null,
  lineup: "unconfirmed",
  games: 40,
  ...over,
});

describe("the market read", () => {
  it("leaves the evaluated book out of the consensus when other books hang the line", () => {
    const pairs = bookPairs([q("dk", "over", -110), q("dk", "under", -110), q("fd", "over", 120), q("fd", "under", -140), q("mgm", "over", 100)]);
    expect([...pairs.keys()].sort()).toEqual(["dk", "fd"]); // mgm has one side only
    const loo = consensusExcluding(pairs, "fd");
    expect(loo).toMatchObject({ books: 1, singleBook: false });
    expect(loo.over).toBeCloseTo(0.5, 9);
  });

  it("with one book only, uses its own pair and says so", () => {
    expect(consensusExcluding(bookPairs([q("dk", "over", -110), q("dk", "under", -110)]), "dk")).toMatchObject({ books: 1, singleBook: true });
    expect(consensusExcluding(new Map(), "dk")).toEqual({ over: null, books: 0, singleBook: false });
  });
});

describe("a side's value", () => {
  it("prices EV at the offered price, conservatively (the lower of s2 and v2), and shows the break-even", () => {
    const [row] = valueRows([input({ s2Over: 0.5, v2Over: 0.48 })], now);
    const o = row.over!;
    expect(o.price).toBe(130);
    expect(o.breakEven).toBeCloseTo(100 / 230, 9);
    expect(o.evV2).toBeCloseTo(0.48 * 2.3 - 1, 9);
    expect(o.evS2).toBeCloseTo(0.5 * 2.3 - 1, 9);
    expect(o.ev).toBeCloseTo(0.48 * 2.3 - 1, 9);
    expect(o.singleBook).toBe(true);
    expect(o.warnings).toEqual(expect.arrayContaining(["single-book", "plus-money-calibration", "lineup-unconfirmed"]));
    // The under side reads the same market from its side.
    expect(row.under!.noVig! + o.noVig!).toBeCloseTo(1, 9);
  });

  it("warns, and drops out of EV ranking, on unstable minutes, injury, extreme distance, stale prices, a thin history or no market", () => {
    const cases: [Partial<ValueInput>, string][] = [
      [{ minutesScale: 7 }, "unstable-minutes"],
      [{ injury: "questionable" }, "injury"],
      [{ v2Z: 1.4 }, "extreme-distance"],
      [{ quotes: [q("dk", "over", 130, STALE_MINUTES + 5), q("dk", "under", -160, STALE_MINUTES + 5)] }, "stale-price"],
      [{ games: 9 }, "sparse-history"],
      // The book says 38% for the over (no-vig of +130 / -160); a model at 55% is 17 pts away.
      [{ s2Over: 0.55, v2Over: 0.4 }, "implausible-disagreement"],
      [{ quotes: [q("dk", "over", 130)] }, "no-market"],
    ];
    for (const [over, warning] of cases) {
      const s = valueRows([input(over)], now)[0].over!;
      expect(s.warnings).toContain(warning);
      expect(s.quality).toBe(false);
    }
    expect(valueRows([input()], now)[0].over!.quality).toBe(true);
  });

  it("an unknown read time is treated as stale, never as fresh", () => {
    const s = valueRows([input({ quotes: [{ ...q("dk", "over", 130), polledAt: null }, q("dk", "under", -160)] })], now)[0].over!;
    expect(s.warnings).toContain("stale-price");
  });

  it("minutes reliability tiers", () => {
    expect([minutesReliability(null), minutesReliability(4), minutesReliability(5), minutesReliability(6.5)]).toEqual(["unknown", "stable", "moderate", "unstable"]);
  });
});

describe("the frozen candidate rule", () => {
  const strong = (id: string, playerId: string, p: number, price = 140) =>
    input({ id, playerId, s2Over: p, v2Over: p, quotes: [q("dk", "over", price), q("dk", "under", -170)] });

  it("needs a +100 to +175 price, the quality gate and +3% EV on both models; one per player; at most six; never 'validated'", () => {
    expect(VALIDATED_RULES).not.toContain(CANDIDATE_RULE.id);
    const rows = valueRows(
      [
        strong("a", "pa", 0.5), // EV +20%
        strong("b", "pa", 0.48), // same player: skipped
        strong("c", "pc", 0.44), // EV +5.6%
        strong("d", "pd", 0.42), // EV +0.8%: under 3%
        strong("e", "pe", 0.6, 200), // +200: outside the range
        input({ id: "f", playerId: "pf", s2Over: 0.5, v2Over: 0.4, quotes: [q("dk", "over", 140), q("dk", "under", -170)] }), // v2 says no
        ...Array.from({ length: 8 }, (_, i) => strong(`x${i}`, `px${i}`, 0.47)),
      ],
      now
    );
    const picked = markCandidates(rows);
    expect(picked).toHaveLength(CANDIDATE_RULE.perSlate);
    expect(picked[0]).toBe("a|over");
    expect(picked).not.toContain("b|over");
    expect(picked.some((x) => x.startsWith("d|") || x.startsWith("e|") || x.startsWith("f|"))).toBe(false);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("a")!.over!.status).toBe("forward-testing");
    expect(byId.get("d")!.over!.status).toBe("research");
    expect(byId.get("e")!.over!.candidateReason).toMatch(/outside/);
  });

  it("only fills the slots left on the slate", () => {
    const rows = () => valueRows(Array.from({ length: 5 }, (_, i) => strong(`y${i}`, `py${i}`, 0.5)), now);
    expect(markCandidates(rows(), 2)).toHaveLength(2);
    expect(markCandidates(rows(), 0)).toEqual([]);
  });

  it("is allowed to pick nobody", () => {
    expect(markCandidates(valueRows([input({ s2Over: 0.42, v2Over: 0.42 })], now))).toEqual([]);
  });

  it("ranks EV only among sides passing the quality gate; the rest by research priority", () => {
    const rows = valueRows([strong("a", "pa", 0.45), input({ id: "z", playerId: "pz", s2Over: 0.7, v2Over: 0.7, injury: "questionable" })], now);
    const order = screenOrder(rows.flatMap((r) => [r.over, r.under]).filter((s) => s !== null).map((s) => ({ s: s! })));
    expect(order[0].rankedBy).toBe("ev");
    expect(order.find((o) => o.s.warnings.includes("injury"))!.rankedBy).toBe("research");
  });
});
