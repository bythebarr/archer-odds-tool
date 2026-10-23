import { describe, expect, it } from "vitest";
import { parseEspnRoster, positionGroup } from "./positions";

describe("positionGroup", () => {
  it("buckets ESPN positions into G / F / C", () => {
    expect(["PG", "SG", "G", "SF", "PF", "F", "C"].map(positionGroup)).toEqual(["G", "G", "G", "F", "F", "F", "C"]);
  });
  it("takes a hybrid's first listed spot", () => {
    expect(positionGroup("G-F")).toBe("G");
    expect(positionGroup("F-C")).toBe("F");
    expect(positionGroup(" c ")).toBe("C");
  });
  it("is null for anything else", () => {
    expect(positionGroup(null)).toBeNull();
    expect(positionGroup("")).toBeNull();
    expect(positionGroup("TE")).toBeNull();
  });
});

describe("parseEspnRoster", () => {
  it("reads a flat athlete list", () => {
    const m = parseEspnRoster({ athletes: [{ id: "1", position: { abbreviation: "PG" } }, { id: "2" }] });
    expect([...m]).toEqual([["1", "PG"]]);
  });
  it("reads a grouped athlete list", () => {
    const m = parseEspnRoster({ athletes: [{ items: [{ id: "3", position: { abbreviation: "C" } }] }] });
    expect(m.get("3")).toBe("C");
  });
  it("tolerates junk", () => {
    expect(parseEspnRoster(null).size).toBe(0);
    expect(parseEspnRoster({}).size).toBe(0);
  });
});
