import { describe, expect, it } from "vitest";
import { parseStatList, statShown, statTileKey, statTiles, toggleStat } from "./statTiles";

describe("stat tiles", () => {
  it("one tile per sport and stat, counted, sport-labeled only when sports mix", () => {
    const one = statTiles([
      { sport: "nba", stat: "points", label: "PTS" },
      { sport: "nba", stat: "steals", label: "STL" },
      { sport: "nba", stat: "points", label: "PTS" },
    ]);
    expect(one).toEqual([
      { key: "nba:points", label: "PTS", count: 2 },
      { key: "nba:steals", label: "STL", count: 1 },
    ]);
    const mixed = statTiles([
      { sport: "nfl", stat: "receptions", label: "REC" },
      { sport: "nba", stat: "points", label: "PTS" },
    ]);
    expect(mixed.map((t) => t.label)).toEqual(["NBA PTS", "NFL REC"]);
  });

  it("keeps two sports' same-named stats apart", () => {
    expect(statTiles([{ sport: "soccer", stat: "shots", label: "SHOTS" }, { sport: "nhl", stat: "shots", label: "SOG" }])).toHaveLength(2);
    expect(statShown(["soccer:shots"], "nhl", "shots")).toBe(true);
    expect(statShown(["soccer:shots"], "soccer", "shots")).toBe(false);
  });

  it("reads comma lists and repeated params, deduped", () => {
    expect(parseStatList("nba:points,nba:steals")).toEqual(["nba:points", "nba:steals"]);
    expect(parseStatList(["nba:points", "nba:steals", "nba:points"])).toEqual(["nba:points", "nba:steals"]);
    expect(parseStatList(undefined)).toEqual([]);
    expect(parseStatList("")).toEqual([]);
  });

  it("toggles a tile off and back on", () => {
    const off = toggleStat([], statTileKey("nba", "steals"));
    expect(off).toEqual(["nba:steals"]);
    expect(toggleStat(off, "nba:steals")).toEqual([]);
  });
});
