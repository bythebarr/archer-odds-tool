import { describe, it, expect } from "vitest";
import { ufcToPlay, ufcAdapter } from "./ufc";
import { unitsFor } from "@/lib/betting/kelly";
import type { UfcBestPlay } from "@/lib/discord/ufcBestPlays";

/**
 * Phase 2 parity: prove the UFC adapter maps a fighter-math best play onto the
 * normalized Play with EXACTLY the values recordUfcPostedPlays persists — so a
 * play routed through the adapter grades identically to one posted the old way.
 */

function bestPlay(over: Partial<UfcBestPlay> = {}): UfcBestPlay {
  return {
    boutId: "bout1",
    side: "blue",
    pickFighterId: "fighterB",
    pickName: "Alessandro Costa",
    opponentName: "Ode' Osbourne",
    prob: 0.58,
    bestPrice: 150,
    bestBookName: "draftkings",
    archerEv: 0.072,
    titleBout: false,
    weightClass: "Flyweight",
    finishLean: null,
    ...over,
  };
}

describe("ufcToPlay (UfcBestPlay → normalized Play)", () => {
  it("mirrors recordUfcPostedPlays' persisted fields exactly", () => {
    const eventDate = new Date("2026-07-19T00:00:00Z"); // Cito date-only @ UTC midnight
    const p = bestPlay();
    const out = ufcToPlay(p, eventDate);
    expect(out).toMatchObject({
      sportKey: "ufc",
      playKey: "ufc:bout1:blue", // recordUfcPostedPlays' key format
      eventRef: "bout1",
      bestPrice: 150,
      bestBookName: "draftkings",
      modelEv: 0.072, // archerEv → modelEv
      marketEv: null, // UFC has no market-devig lens
      suggestedUnits: unitsFor(0.072, 150),
      selection: { market: "h2h", kind: "ml", side: "blue", point: null, label: "Alessandro Costa" },
    });
  });

  it("records the play under the FIGHT's ET date (settles the day after the tease)", () => {
    // UTC-midnight Jul 19 is still Jul 18 in ET (UTC-4) — the fight's calendar day.
    const eventDate = new Date("2026-07-19T00:00:00Z");
    expect(ufcToPlay(bestPlay(), eventDate).postedForDate).toBe("2026-07-18");
  });

  it("sizes units off the model edge with the same shared Kelly sizing as MLB", () => {
    const p = bestPlay({ archerEv: 0.12, bestPrice: -120 });
    expect(ufcToPlay(p, new Date("2026-07-19T00:00:00Z")).suggestedUnits).toBe(unitsFor(0.12, -120));
  });

  it("backs the red corner when that's the value side", () => {
    const out = ufcToPlay(bestPlay({ side: "red", pickName: "Ode' Osbourne" }), new Date("2026-07-19T00:00:00Z"));
    expect(out.playKey).toBe("ufc:bout1:red");
    expect(out.selection.side).toBe("red");
  });
});

describe("adapter registration surface", () => {
  it("declares UFC's contract: moneyline only, fighter-math model, no props", () => {
    expect(ufcAdapter.key).toBe("ufc");
    expect(ufcAdapter.meta.sport).toBe("ufc");
    expect(ufcAdapter.model?.describes).toContain("fighter-math");
    expect(ufcAdapter.markets.map((m) => m.kind)).toEqual(["ml"]);
    expect(ufcAdapter.props).toBeUndefined(); // The Odds API has no MMA props
  });
});
