import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/espn-summary-401878764.json";
import { clockMinute, minutesPlayed, parseSoccerSummary, positionGroup, type EspnSoccerSummary } from "./playerStats";

describe("soccer player box scores", () => {
  it("reads ESPN's clocks and position codes", () => {
    expect(clockMinute("52'")).toBe(52);
    expect(clockMinute("90'+3'")).toBe(90);
    expect(clockMinute(undefined)).toBeNull();
    expect(positionGroup("G")).toBe("G");
    expect(positionGroup("CD-L")).toBe("D");
    expect(positionGroup("RB")).toBe("D");
    expect(positionGroup("AM-R")).toBe("M");
    expect(positionGroup("DM")).toBe("M");
    expect(positionGroup("CF")).toBe("F");
    expect(positionGroup("F")).toBe("F");
    expect(positionGroup("SUB")).toBeNull();
  });

  it("works out minutes from substitutions and red cards", () => {
    const sub = (m: string) => ({ clock: { displayValue: m }, substitution: true });
    expect(minutesPlayed({ starter: true }, 90)).toBe(90);
    expect(minutesPlayed({ starter: true, subbedOut: true, plays: [sub("65'")] }, 90)).toBe(65);
    expect(minutesPlayed({ subbedIn: true, plays: [sub("79'")] }, 90)).toBe(11);
    expect(minutesPlayed({ subbedIn: true, subbedOut: true, plays: [sub("46'"), sub("80'")] }, 90)).toBe(34);
    expect(minutesPlayed({ starter: true, plays: [{ clock: { displayValue: "30'" }, redCard: true }] }, 90)).toBe(30);
    expect(minutesPlayed({}, 90)).toBe(0);
  });

  it("parses a real match: only players who got on, both sides", () => {
    const lines = parseSoccerSummary(fixture as EspnSoccerSummary);
    const sunderland = lines.filter((l) => l.team === "Sunderland");
    expect(sunderland.filter((l) => l.starter)).toHaveLength(11);
    expect(sunderland.every((l) => l.opponent === "Leeds United" && l.isHome)).toBe(true);
    const brobbey = lines.find((l) => l.name === "Brian Brobbey")!;
    expect(brobbey).toMatchObject({ position: "F", minutes: 65, shots: 2, shotsOnTarget: 2 });
    const roefs = lines.find((l) => l.name === "Robin Roefs")!;
    expect(roefs).toMatchObject({ position: "G", minutes: 90, saves: 3 });
    expect(lines.find((l) => l.name === "Habib Diarra")).toMatchObject({ starter: false, minutes: 11 });
    expect(lines.some((l) => l.name === "Jules Ahoka")).toBe(false);
    expect(lines.filter((l) => l.team === "Leeds United").length).toBeGreaterThanOrEqual(11);
  });
});
