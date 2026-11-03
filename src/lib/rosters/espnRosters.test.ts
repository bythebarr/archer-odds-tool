import { describe, expect, it } from "vitest";
import { rosterAthleteIds } from "./espnRosters";

describe("rosterAthleteIds", () => {
  it("reads NBA's flat list", () => {
    expect(rosterAthleteIds({ athletes: [{ id: "1" }, { id: "2" }] })).toEqual(["1", "2"]);
  });
  it("reads NFL's groups (offense, defense, injured reserve …)", () => {
    expect(rosterAthleteIds({ athletes: [{ position: "offense", items: [{ id: "10" }, { id: "11" }] }, { position: "defense", items: [{ id: "20" }] }] })).toEqual(["10", "11", "20"]);
  });
  it("is empty on a bad payload", () => {
    expect(rosterAthleteIds(null)).toEqual([]);
    expect(rosterAthleteIds({})).toEqual([]);
  });
});
