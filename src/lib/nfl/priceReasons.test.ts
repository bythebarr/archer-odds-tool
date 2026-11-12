import { describe, expect, it } from "vitest";
import { nflPriceReasons, type NflReasonInput } from "./priceReasons";

const base: NflReasonInput = { side: "over", statShort: "REC YDS", opponent: "NYG", position: "WR", matchupFactor: 1, volumeFactor: 1, scriptFactor: 1, spread: null, absence: null, mean: 60, def: null };

describe("nflPriceReasons", () => {
  it("nothing notable, nothing said", () => {
    expect(nflPriceReasons(base)).toEqual([]);
  });

  it("marks each reason for or against the chosen side, supporting ones first", () => {
    const r = nflPriceReasons({ ...base, matchupFactor: 1.12, scriptFactor: 0.94, spread: -7.5, def: { position: "WR", perGame: 180, leagueAvg: 150, rank: 2, of: 32 } });
    expect(r[0].supports).toBe(true);
    expect(r.map((x) => x.text)).toContain("NYG gives up 12% more REC YDS than average");
    expect(r.find((x) => x.text.startsWith("NYG ranks 2nd"))!.supports).toBe(true);
    expect(r.find((x) => x.text.startsWith("7.5-point favorite"))!.supports).toBe(false);
    const under = nflPriceReasons({ ...base, side: "under", matchupFactor: 1.12 });
    expect(under[0].supports).toBe(false);
  });

  it("teammates out push the way their games went", () => {
    expect(nflPriceReasons({ ...base, absence: { names: ["A. Brown"], perGame: 75 } })[0]).toEqual({ text: "With A. Brown out: 75.0 a game in those games", supports: true });
  });
});
