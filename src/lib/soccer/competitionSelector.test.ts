import { describe, expect, it } from "vitest";
import { pickActiveSoccerKeys, SOCCER_PREFERENCE } from "./competitionSelector";

/** Soccer competition selection (Phase 2 D2): the self-selecting replacement for the frozen World-Cup-only constant. */
const entry = (key: string, active = true) => ({ key, active });

describe("pickActiveSoccerKeys", () => {
  it("picks active competitions in preference order, not list order", () => {
    const sports = [entry("soccer_usa_mls"), entry("soccer_epl"), entry("soccer_fifa_world_cup", false), entry("soccer_spain_la_liga")];
    expect(pickActiveSoccerKeys(sports, 10)).toEqual(["soccer_epl", "soccer_spain_la_liga", "soccer_usa_mls"]);
  });
  it("enforces the credit cap", () => {
    const sports = SOCCER_PREFERENCE.map((k) => entry(k));
    expect(pickActiveSoccerKeys(sports, 3)).toEqual(SOCCER_PREFERENCE.slice(0, 3));
    expect(pickActiveSoccerKeys(sports, 0)).toEqual([]);
  });
  it("ignores competitions outside the preference list and inactive ones", () => {
    const sports = [entry("soccer_brazil_campeonato"), entry("soccer_epl", false)];
    expect(pickActiveSoccerKeys(sports, 5)).toEqual([]);
  });
  it("the World Cup outranks everything in its years", () => {
    const sports = [entry("soccer_epl"), entry("soccer_fifa_world_cup")];
    expect(pickActiveSoccerKeys(sports, 1)).toEqual(["soccer_fifa_world_cup"]);
  });
});
