import { describe, expect, it } from "vitest";
import { pickActiveTennisKeys } from "./competitionSelector";

/** Tennis tournament selection (Phase 2 D2): the self-selecting replacement for the frozen Wimbledon constants. */
const entry = (key: string, active = true, has_outrights = false) => ({ key, active, has_outrights });

describe("pickActiveTennisKeys", () => {
  it("ATP first, then WTA, one per tour by default", () => {
    const sports = [entry("tennis_wta_us_open"), entry("tennis_atp_us_open"), entry("tennis_atp_masters_1000"), entry("tennis_wta_1000")];
    expect(pickActiveTennisKeys(sports)).toEqual(["tennis_atp_us_open", "tennis_wta_us_open"]);
  });
  it("excludes outrights/futures and inactive keys", () => {
    const sports = [
      entry("tennis_atp_wimbledon_winner"),
      entry("tennis_atp_french_open", true, true),
      entry("tennis_atp_queens", false),
      entry("tennis_wta_eastbourne"),
    ];
    expect(pickActiveTennisKeys(sports)).toEqual(["tennis_wta_eastbourne"]);
  });
  it("capPerTour widens both tours symmetrically", () => {
    const sports = [entry("tennis_atp_a"), entry("tennis_atp_b"), entry("tennis_wta_a"), entry("tennis_wta_b")];
    expect(pickActiveTennisKeys(sports, 2)).toEqual(["tennis_atp_a", "tennis_atp_b", "tennis_wta_a", "tennis_wta_b"]);
    expect(pickActiveTennisKeys(sports, 0)).toEqual([]);
  });
  it("nothing active: empty, the honest off-season answer", () => {
    expect(pickActiveTennisKeys([entry("tennis_atp_wimbledon", false)])).toEqual([]);
  });
});
