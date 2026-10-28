import { describe, expect, it } from "vitest";
import { normalizeFighterName, parseHeight, parseReach, parseWeightClass, statsRow, sumStats } from "./ufcStatsArchive";

const row = (o: Record<string, string>) => ({ FIGHTER: "A", KD: "1", "SIG.STR.": "24 of 47", "TOTAL STR.": "25 of 48", TD: "1 of 3", "SUB.ATT": "0", "REV.": "0", CTRL: "1:18", HEAD: "18 of 40", BODY: "3 of 4", LEG: "3 of 3", DISTANCE: "22 of 44", CLINCH: "2 of 3", GROUND: "0 of 0", ...o });

describe("UFCStats archive", () => {
  it("parses a round's stat line", () => {
    const s = statsRow(row({}));
    expect(s).toMatchObject({ knockdowns: 1, significantStrikesLanded: 24, significantStrikesAttempted: 47, takedownsLanded: 1, takedownsAttempted: 3, controlTimeSeconds: 78, legStrikesLanded: 3 });
    expect(statsRow(row({ CTRL: "--" })).controlTimeSeconds).toBe(0);
  });

  it("sums rounds into the bout line", () => {
    const s = sumStats([statsRow(row({})), statsRow(row({ KD: "0", "SIG.STR.": "10 of 20" }))]);
    expect(s.significantStrikesLanded).toBe(34);
    expect(s.knockdowns).toBe(1);
    expect(s.controlTimeSeconds).toBe(156);
  });

  it("reads weight classes, heights and reach", () => {
    expect(parseWeightClass("UFC Featherweight Title Bout")).toEqual({ weightClass: "Featherweight", title: true });
    expect(parseWeightClass("Women's Strawweight Bout")).toEqual({ weightClass: "Women's Strawweight", title: false });
    expect(parseWeightClass("UFC Interim Light Heavyweight Title Bout").weightClass).toBe("Light Heavyweight");
    expect(parseHeight(`5' 11"`)).toBe(71);
    expect(parseReach(`72"`)).toBe(72);
    expect(parseReach("--")).toBeNull();
    expect(normalizeFighterName("  José  Aldo ")).toBe("jose aldo");
  });
});
