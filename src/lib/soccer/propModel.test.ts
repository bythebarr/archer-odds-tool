import { describe, expect, it } from "vitest";
import {
  SOCCER_PROP_STAT_BY_KEY,
  countPmf,
  minutesRole,
  packSoccerLog,
  per90,
  probOver,
  projectSoccerProp,
  projectionOver,
  soccerLine,
  tilt,
  unpackSoccerLog,
  type SoccerLog,
} from "./propModel";

const log = (date: string, minutes: number, goals = 0, shots = 0): SoccerLog => ({
  date, opponent: "X", isHome: true, season: 2026, team: "T", starter: minutes >= 60, minutes,
  goals, assists: 0, shots, shotsOnTarget: 0, saves: 0, yellowCards: 0, redCards: 0, fouls: 0,
});
const ctx = { isHome: true, oppShotsAllowed: null, oppSotFor: null, leagueShots: 12, leagueSot: 4 };

describe("soccer prop model", () => {
  it("counts sum to one, Poisson and negative binomial alike", () => {
    for (const r of [Infinity, 5]) {
      let t = 0;
      for (let k = 0; k < 60; k++) t += countPmf(k, 2.3, r);
      expect(t).toBeCloseTo(1, 6);
    }
    expect(probOver(0.4, 0.5, Infinity)).toBeCloseTo(1 - Math.exp(-0.4), 6);
  });

  it("reads a role from the team's recent matches, absences as zero", () => {
    const dates = ["2026-10-25", "2026-10-18", "2026-10-11", "2026-10-04", "2026-09-27", "2026-09-20"];
    const regular = minutesRole(dates.map((d) => log(d, 90)), dates);
    expect(regular.playProb).toBeGreaterThan(0.85);
    expect(regular.minutes).toBe(90);
    const rotation = minutesRole([log(dates[1]!, 70), log(dates[3]!, 80)], dates);
    expect(rotation.playProb).toBeLessThan(0.5);
    expect(rotation.expected).toBeLessThan(40);
    expect(minutesRole([], dates).playProb).toBe(0);
  });

  it("shrinks a small sample toward the position's rate", () => {
    const goal = SOCCER_PROP_STAT_BY_KEY.get("goal")!;
    const hotStart = [log("2026-10-25", 90, 2)];
    const r = per90(hotStart, goal, "F");
    expect(r).toBeGreaterThan(0.38);
    expect(r).toBeLessThan(0.8);
  });

  it("prices the anytime goal and sets count lines near even", () => {
    const dates = ["2026-10-25", "2026-10-18", "2026-10-11", "2026-10-04", "2026-09-27", "2026-09-20"];
    const logs = dates.map((d, i) => log(d, 90, i % 2, 3));
    const goal = SOCCER_PROP_STAT_BY_KEY.get("goal")!;
    const p = projectSoccerProp(logs, dates, goal, "F", ctx);
    const chance = projectionOver(p, 0.5, goal);
    expect(chance).toBeGreaterThan(0.25);
    expect(chance).toBeLessThan(0.55);
    const shots = SOCCER_PROP_STAT_BY_KEY.get("shots")!;
    const ps = projectSoccerProp(logs, dates, shots, "F", ctx);
    const line = soccerLine(shots, ps);
    expect([1.5, 2.5]).toContain(line);
    expect(Math.abs(projectionOver(ps, line, shots) - 0.5)).toBeLessThan(0.2);
  });

  it("bounds the matchup tilt and round-trips packed logs", () => {
    expect(tilt(null, 12, 1)).toBe(1);
    expect(tilt(30, 12, 1)).toBe(1.5);
    expect(tilt(2, 12, 1)).toBe(0.67);
    const l = log("2026-10-25", 63, 1, 4);
    expect(unpackSoccerLog(packSoccerLog(l))).toEqual(l);
  });
});
