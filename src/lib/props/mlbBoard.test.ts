import { describe, it, expect } from "vitest";
import { assembleLineCells, tallyPointSample, MLB_STAT_DEFS, type PropLogEntry } from "./mlbBoard";
import { StatCategory } from "@/generated/prisma/client";

// Most-recent-first, with one unrecorded (null) game that must be excluded.
const log: PropLogEntry[] = [
  { value: 2, splits: ["vsLHP"] },
  { value: 0, splits: ["vsRHP"] },
  { value: 1, splits: ["vsLHP"] },
  { value: 3, splits: ["vsRHP"] },
  { value: null, splits: ["vsLHP"] }, // excluded from every sample
  { value: 2, splits: ["vsRHP"] },
];

const WINDOWS = [
  { key: "l5", n: 5 as const },
  { key: "season", n: "season" as const },
];
const SPLITS = ["vsLHP", "vsRHP"];

describe("assembleLineCells", () => {
  const lines = assembleLineCells(log, [0.5, 1.5, 2.5], WINDOWS, SPLITS);
  const at = (line: number) => lines.find((l) => l.line === line)!;

  it("produces a cell set per requested line", () => {
    expect(lines.map((l) => l.line)).toEqual([0.5, 1.5, 2.5]);
  });

  it("excludes null-value games from the season sample", () => {
    // 5 recorded games (the null dropped), 4 clear Over 0.5.
    expect(at(0.5).cells.season).toMatchObject({ hits: 4, sampleSize: 5 });
    expect(at(0.5).cells.season!.hitRate).toBeCloseTo(0.8);
  });

  it("counts Over the line strictly (> line)", () => {
    // Over 1.5 => value >= 2: values 2,3,2 => 3 of 5.
    expect(at(1.5).cells.season).toMatchObject({ hits: 3, sampleSize: 5 });
    // Over 2.5 => value >= 3: only the single 3.
    expect(at(2.5).cells.season).toMatchObject({ hits: 1, sampleSize: 5 });
  });

  it("splits by the tagged split keys over recorded games only", () => {
    // vsLHP recorded values: [2, 1]; both clear Over 0.5.
    expect(at(0.5).cells.vsLHP).toMatchObject({ hits: 2, sampleSize: 2 });
    // vsRHP recorded values: [0, 3, 2]; 2 clear Over 0.5.
    expect(at(0.5).cells.vsRHP).toMatchObject({ hits: 2, sampleSize: 3 });
  });

  it("windows the last N recorded games", () => {
    // Only 5 recorded games, so L5 == season here.
    expect(at(1.5).cells.l5).toEqual(at(1.5).cells.season);
  });

  it("returns a null hit rate when there is no sample", () => {
    const empty = assembleLineCells([{ value: null, splits: [] }], [0.5], WINDOWS, SPLITS);
    expect(empty[0].cells.season).toMatchObject({ sampleSize: 0, hitRate: null });
    expect(empty[0].cells.vsLHP).toMatchObject({ sampleSize: 0, hitRate: null });
  });
});

describe("tallyPointSample", () => {
  // Most-recent-first, 6 season values.
  const values = [2, 0, 1, 3, 2, 1];

  it("tallies at an arbitrary point, not just a stat's standardLines", () => {
    // point 1.0 (not a standard line for any MLB stat): values > 1 => 2,3,2 => 3 of 6.
    const sample = tallyPointSample(values, 1.0);
    expect(sample).toMatchObject({ seasonHits: 3, seasonSample: 6 });
  });

  it("computes recentRate over only the first 10 (or fewer) values", () => {
    // All 6 values are within L10 here, so recentRate should equal the season rate at this point.
    const sample = tallyPointSample(values, 0.5);
    expect(sample.recentRate).toBeCloseTo(sample.seasonHits / sample.seasonSample, 10);
  });

  it("returns a zeroed, null-rate sample for an empty array", () => {
    expect(tallyPointSample([], 0.5)).toEqual({ seasonHits: 0, seasonSample: 0, recentRate: null });
  });

  it("agrees with assembleLineCells' own tally at one of a stat's real standard lines", () => {
    const log: PropLogEntry[] = values.map((value) => ({ value, splits: [] }));
    const viaBoard = assembleLineCells(log, [1.5], WINDOWS, []);
    const viaPointSample = tallyPointSample(values, 1.5);
    expect(viaPointSample.seasonHits).toBe(viaBoard[0].cells.season!.hits);
    expect(viaPointSample.seasonSample).toBe(viaBoard[0].cells.season!.sampleSize);
  });
});

describe("MLB_STAT_DEFS", () => {
  it("has an entry for every StatCategory enum value", () => {
    for (const stat of Object.values(StatCategory)) {
      expect(MLB_STAT_DEFS[stat]).toBeDefined();
    }
  });

  it("gives every stat a unique, non-empty PlayerGameLog column", () => {
    const columns = Object.values(MLB_STAT_DEFS).map((d) => d.column);
    expect(columns.every((c) => c.length > 0)).toBe(true);
    expect(new Set(columns).size).toBe(columns.length);
  });
});
