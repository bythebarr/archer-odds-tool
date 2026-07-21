import { describe, expect, it } from "vitest";
import { collapseDuplicateMarkets } from "./storeOdds";
import type { OddsApiMarket } from "./oddsApiClient";

/**
 * The duplicate-block case is real ParlayAPI behaviour, not a hypothetical: on
 * 2026-07-21 FanDuel was quoted twice with different h2h prices on 5 of 15 MLB
 * games. These lock in that we resolve it toward the price a member can
 * actually get, rather than whichever block happened to arrive last.
 */
const market = (key: string, outcomes: OddsApiMarket["outcomes"], last_update?: string): OddsApiMarket =>
  ({ key, outcomes, last_update }) as OddsApiMarket;

describe("collapseDuplicateMarkets", () => {
  it("leaves a single quote untouched", () => {
    const markets = [market("h2h", [{ name: "Yankees", price: -138, point: undefined }])];
    expect(collapseDuplicateMarkets(markets)).toEqual(markets);
  });

  it("keeps the worse side of a duplicated favourite (more negative)", () => {
    const collapsed = collapseDuplicateMarkets([
      market("h2h", [{ name: "Yankees", price: -138, point: undefined }]),
      market("h2h", [{ name: "Yankees", price: -168, point: undefined }]),
    ]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].outcomes).toEqual([{ name: "Yankees", price: -168, point: undefined }]);
  });

  it("keeps the worse side of a duplicated underdog (smaller plus)", () => {
    const collapsed = collapseDuplicateMarkets([
      market("h2h", [{ name: "Pirates", price: 142, point: undefined }]),
      market("h2h", [{ name: "Pirates", price: 118, point: undefined }]),
    ]);
    expect(collapsed[0].outcomes).toEqual([{ name: "Pirates", price: 118, point: undefined }]);
  });

  it("resolves each side independently — the worst of each, not the worst block", () => {
    const collapsed = collapseDuplicateMarkets([
      market("h2h", [
        { name: "Yankees", price: -138, point: undefined },
        { name: "Pirates", price: 118, point: undefined },
      ]),
      market("h2h", [
        { name: "Yankees", price: -168, point: undefined },
        { name: "Pirates", price: 142, point: undefined },
      ]),
    ]);
    expect(collapsed[0].outcomes).toEqual([
      { name: "Yankees", price: -168, point: undefined },
      { name: "Pirates", price: 118, point: undefined },
    ]);
  });

  it("does not collapse the same side at different numbers", () => {
    const collapsed = collapseDuplicateMarkets([
      market("totals", [{ name: "Over", price: -110, point: 8.5 }]),
      market("totals", [{ name: "Over", price: -110, point: 9.5 }]),
    ]);
    expect(collapsed[0].outcomes).toHaveLength(2);
    expect(collapsed[0].outcomes.map((o) => o.point).sort()).toEqual([8.5, 9.5]);
  });

  it("reports the older timestamp — the newer one would overstate what we know", () => {
    const collapsed = collapseDuplicateMarkets([
      market("h2h", [{ name: "Yankees", price: -138, point: undefined }], "2026-07-21T18:00:00Z"),
      market("h2h", [{ name: "Yankees", price: -168, point: undefined }], "2026-07-21T17:00:00Z"),
    ]);
    expect(collapsed[0].last_update).toBe("2026-07-21T17:00:00Z");
  });

  it("keeps distinct markets separate", () => {
    const collapsed = collapseDuplicateMarkets([
      market("h2h", [{ name: "Yankees", price: -138, point: undefined }]),
      market("totals", [{ name: "Over", price: -110, point: 8.5 }]),
    ]);
    expect(collapsed.map((m) => m.key)).toEqual(["h2h", "totals"]);
  });

  it("ignores a priceless outcome rather than letting it win the comparison", () => {
    const collapsed = collapseDuplicateMarkets([
      market("h2h", [{ name: "Yankees", price: null as unknown as number, point: undefined }]),
      market("h2h", [{ name: "Yankees", price: -168, point: undefined }]),
    ]);
    expect(collapsed[0].outcomes).toEqual([{ name: "Yankees", price: -168, point: undefined }]);
  });
});
