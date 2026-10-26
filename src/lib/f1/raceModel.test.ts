import { describe, expect, it } from "vitest";
import { F1Ratings, fairAmerican, retirementOf, simulateRace, type F1RaceRecord } from "./raceModel";

/** Car i's pace is i; each car has two drivers, the "a" driver slightly quicker. */
function season(races: number, startId = 0, year = 2025): F1RaceRecord[] {
  const out: F1RaceRecord[] = [];
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < races; r++) {
    const perf = [];
    for (let c = 0; c < 5; c++)
      for (const d of ["a", "b"]) perf.push({ driverId: `d${c}${d}`, constructorId: `c${c}`, v: c * 0.8 + (d === "a" ? 0.3 : 0) - Math.log(-Math.log(rand())) });
    perf.sort((x, y) => y.v - x.v);
    out.push({
      id: `r${startId + r}`,
      season: year,
      date: new Date(Date.UTC(year, 2, 1 + r * 14)),
      entries: perf.map((p, i) => ({ driverId: p.driverId, constructorId: p.constructorId, position: i + 1, status: "Finished", laps: 57 })),
    });
  }
  return out;
}

describe("F1Ratings", () => {
  it("learns the fast car and the quicker teammate", () => {
    const r = new F1Ratings();
    for (const race of season(40)) r.update(race);
    expect(r.carPace("c4")).toBeGreaterThan(r.carPace("c0"));
    expect(r.driverPace("d4a")).toBeGreaterThan(r.driverPace("d4b"));
  });
  it("reverts the car harder than the driver at a new season", () => {
    const r = new F1Ratings();
    for (const race of season(30)) {
      r.touch(race.entries, race.season);
      r.update(race);
    }
    const car = r.carPace("c4");
    const drv = r.driverPace("d4a");
    r.touch([{ driverId: "d4a", constructorId: "c4" }], 2026);
    expect(Math.abs(r.carPace("c4"))).toBeLessThan(Math.abs(car) * 0.6);
    expect(Math.abs(r.driverPace("d4a"))).toBeGreaterThan(Math.abs(drv) * 0.8);
  });
  it("counts an engine failure against the car, a crash against the driver", () => {
    expect(retirementOf({ driverId: "x", constructorId: "y", position: null, status: "Engine", laps: 10 })).toBe("mechanical");
    expect(retirementOf({ driverId: "x", constructorId: "y", position: null, status: "Collision", laps: 1 })).toBe("incident");
    expect(retirementOf({ driverId: "x", constructorId: "y", position: 12, status: "+1 Lap", laps: 56 })).toBe("none");
    const r = new F1Ratings();
    const race = season(1)[0];
    race.entries[0] = { ...race.entries[0], position: null, status: "Engine" };
    for (let i = 0; i < 10; i++) r.update(race);
    expect(r.mechanicalRate(race.entries[0].constructorId)).toBeGreaterThan(r.mechanicalRate("c-unknown"));
  });
});

describe("simulateRace", () => {
  const r = new F1Ratings();
  for (const race of season(40)) r.update(race);
  const entries = season(1)[0].entries.map((e) => ({ driverId: e.driverId, constructorId: e.constructorId }));
  const odds = simulateRace(r, entries, 8000);
  it("gives probabilities that add up", () => {
    expect(odds.reduce((a, o) => a + o.win, 0)).toBeCloseTo(1, 6);
    expect(odds.reduce((a, o) => a + o.podium, 0)).toBeCloseTo(3, 6);
    expect(odds.reduce((a, o) => a + o.points, 0)).toBeCloseTo(10, 6);
  });
  it("makes the fastest car's lead driver the favorite", () => {
    expect(odds[0].driverId).toBe("d4a");
    expect(odds[0].beatsTeammate!).toBeGreaterThan(0.5);
  });
  it("prices fair odds", () => {
    expect(fairAmerican(0.5)).toBe(-100);
    expect(fairAmerican(0.25)).toBe(300);
    expect(fairAmerican(0.8)).toBe(-400);
  });
});
