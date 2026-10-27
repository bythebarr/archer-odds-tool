import { describe, expect, it } from "vitest";
import { dropEspnTwins } from "./allSports";

describe("dropEspnTwins", () => {
  it("keeps the feed's copy of a game ESPN also lists, and ESPN's games the feed doesn't", () => {
    const t = new Date("2026-10-31T15:00:00Z");
    const events = [
      { id: "espn:1", leagueId: "soccer/epl", startsAt: t, home: "AFC Bournemouth", away: "Leeds United" },
      { id: "toa:x", leagueId: "soccer/epl", startsAt: new Date(t.getTime() + 3_600_000), home: "Bournemouth", away: "Leeds United" },
      { id: "espn:2", leagueId: "soccer/epl", startsAt: t, home: "Arsenal", away: "Chelsea" },
    ];
    expect(dropEspnTwins(events).map((e) => e.id)).toEqual(["toa:x", "espn:2"]);
  });
});
