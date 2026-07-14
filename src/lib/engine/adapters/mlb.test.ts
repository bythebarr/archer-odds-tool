import { describe, it, expect } from "vitest";
import { toPlay, selectBoardPlays, parsePropKey, mlbAdapter } from "./mlb";
import { unitsFor } from "@/lib/betting/kelly";
import type { OddsPlay } from "@/lib/queries/oddsPool";

/**
 * Phase 1 parity: prove the MLB adapter reproduces today's card byte-for-byte.
 * The card's selection (postCard.ts) is `plays.filter(modelEv !== null &&
 * modelEv > 0).sort((a,b) => b.modelEv - a.modelEv)`, and its units are
 * `unitsFor(modelEv, bestPrice)`. selectBoardPlays + toPlay must match both.
 */

const DATE = "2026-07-14";

// Full OddsPlay fixture — every field toPlay reads, overridable per case.
function play(over: Partial<OddsPlay>): OddsPlay {
  return {
    key: "g1:h2h:home:",
    sport: "mlb",
    matchId: "g1",
    startUtc: new Date("2026-07-14T23:05:00Z"),
    href: "/games/g1",
    home: { name: "Red Sox", meta: "BOS" },
    away: { name: "Yankees", meta: "NYY" },
    market: "h2h",
    kind: "ml",
    side: "home",
    point: null,
    selectionLabel: "Red Sox",
    backed: "home",
    bestPrice: 120,
    bestDecimal: 2.2,
    bestBookKey: "fanduel",
    bestBookName: "FanDuel",
    bestBookInitials: "FD",
    booksCount: 4,
    ev: 0.03,
    modelEv: 0.08,
    ...over,
  } as OddsPlay;
}

describe("toPlay (OddsPlay → normalized Play)", () => {
  it("maps every field onto the engine's Play shape", () => {
    const p = play({});
    const out = toPlay(p, DATE);
    expect(out).toMatchObject({
      sportKey: "mlb",
      playKey: "g1:h2h:home:",
      eventRef: "g1",
      postedForDate: DATE,
      startUtc: p.startUtc,
      bestPrice: 120,
      bestBookName: "FanDuel",
      marketEv: 0.03, // OddsPlay.ev  → marketEv
      modelEv: 0.08, // OddsPlay.modelEv → modelEv
      selection: { market: "h2h", kind: "ml", side: "home", point: null, label: "Red Sox" },
      display: { href: "/games/g1", backed: "home", bestBookInitials: "FD", booksCount: 4 },
    });
  });

  it("sizes suggestedUnits off the MODEL edge, exactly as the card does", () => {
    const p = play({ modelEv: 0.08, ev: 0.03, bestPrice: 120 });
    expect(toPlay(p, DATE).suggestedUnits).toBe(unitsFor(0.08, 120));
  });

  it("falls back to the market edge when there is no model edge", () => {
    const p = play({ modelEv: null, ev: 0.05, bestPrice: -110 });
    expect(toPlay(p, DATE).suggestedUnits).toBe(unitsFor(0.05, -110));
  });

  it("floors suggestedUnits when neither lens prices the play", () => {
    const p = play({ modelEv: null, ev: null });
    expect(toPlay(p, DATE).suggestedUnits).toBe(0.25);
  });
});

describe("selectBoardPlays (byte-for-byte with postCard's selection)", () => {
  it("keeps only positive-model-EV plays, sorted by edge descending", () => {
    const pool: OddsPlay[] = [
      play({ key: "a", modelEv: 0.04 }),
      play({ key: "b", modelEv: 0.11 }),
      play({ key: "c", modelEv: -0.02 }), // negative — dropped
      play({ key: "d", modelEv: 0.07 }),
    ];
    expect(selectBoardPlays(pool).map((p) => p.key)).toEqual(["b", "d", "a"]);
  });

  it("drops plays with no model edge (props, tennis, soccer)", () => {
    const pool: OddsPlay[] = [
      play({ key: "prop", kind: "prop", market: null, modelEv: null, ev: 0.2 }),
      play({ key: "ten", sport: "tennis", modelEv: null, ev: 0.15 }),
      play({ key: "mlb", modelEv: 0.06 }),
    ];
    expect(selectBoardPlays(pool).map((p) => p.key)).toEqual(["mlb"]);
  });

  it("matches postCard's exact filter+sort expression", () => {
    const pool: OddsPlay[] = [
      play({ key: "a", modelEv: 0.02, ev: 0.5 }), // pool is market-ev sorted; must re-sort by model
      play({ key: "b", modelEv: 0.09, ev: 0.01 }),
      play({ key: "c", modelEv: null, ev: 0.9 }),
      play({ key: "d", modelEv: 0.05, ev: 0.2 }),
    ];
    // Verbatim copy of postDailyCardToDiscord's selection.
    const cardPicks = pool
      .filter((p): p is OddsPlay & { modelEv: number } => p.modelEv !== null)
      .filter((p) => p.modelEv > 0)
      .sort((a, b) => b.modelEv - a.modelEv);
    expect(selectBoardPlays(pool).map((p) => p.key)).toEqual(cardPicks.map((p) => p.key));
  });
});

describe("parsePropKey (grade's prop-input recovery)", () => {
  it("recovers player + stat from a prop playKey", () => {
    // `${gameId}:prop:${mlbPlayerId}:${stat}:${side}:${point}` (see oddsPool.propPlays)
    expect(parsePropKey("g1:prop:player123:hits:over:0.5")).toEqual({
      mlbPlayerId: "player123",
      stat: "hits",
    });
  });

  it("returns null for a non-prop (game-line) key", () => {
    expect(parsePropKey("g1:h2h:home:")).toBeNull();
    expect(parsePropKey("g1:totals:over:8.5")).toBeNull();
  });
});

describe("adapter registration surface", () => {
  it("declares MLB's contract: key, model, markets, props", () => {
    expect(mlbAdapter.key).toBe("mlb");
    expect(mlbAdapter.meta.sport).toBe("mlb");
    expect(mlbAdapter.model?.describes).toContain("win probability");
    expect(mlbAdapter.markets.map((m) => m.market)).toEqual(["h2h", "spreads", "totals"]);
    expect(mlbAdapter.props?.some((p) => p.key === "hits")).toBe(true);
  });
});
