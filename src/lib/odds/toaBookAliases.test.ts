import { describe, expect, it } from "vitest";
import { canonicalizeBookmakers, type OddsApiEvent } from "./oddsApiClient";

describe("canonicalizeBookmakers", () => {
  it("maps The Odds API's book keys onto ours and leaves the rest", () => {
    const event = {
      id: "e",
      sport_key: "basketball_nba",
      commence_time: "",
      home_team: "",
      away_team: "",
      bookmakers: [
        { key: "williamhill_us", title: "Caesars", markets: [] },
        { key: "hardrockbet", title: "Hard Rock Bet", markets: [] },
        { key: "draftkings", title: "DraftKings", markets: [] },
      ],
    } as OddsApiEvent;
    expect(canonicalizeBookmakers(event).bookmakers.map((b) => b.key)).toEqual(["caesars", "hardrock", "draftkings"]);
  });
});
