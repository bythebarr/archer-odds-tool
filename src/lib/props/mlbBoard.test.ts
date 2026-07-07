import { describe, it, expect } from "vitest";
import { assembleLineCells, type PropLogEntry } from "./mlbBoard";

// Most-recent-first, with one unrecorded (null) game that must be excluded.
const log: PropLogEntry[] = [
  { value: 2, opposingHand: "L" },
  { value: 0, opposingHand: "R" },
  { value: 1, opposingHand: "L" },
  { value: 3, opposingHand: "R" },
  { value: null, opposingHand: "L" }, // excluded from every sample
  { value: 2, opposingHand: "R" },
];

describe("assembleLineCells", () => {
  const lines = assembleLineCells(log, [0.5, 1.5, 2.5]);
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

  it("splits by opposing hand over recorded games only", () => {
    // vs LHP recorded values: [2, 1]; both clear Over 0.5.
    expect(at(0.5).cells.vsLHP).toMatchObject({ hits: 2, sampleSize: 2 });
    // vs RHP recorded values: [0, 3, 2]; 2 clear Over 0.5.
    expect(at(0.5).cells.vsRHP).toMatchObject({ hits: 2, sampleSize: 3 });
  });

  it("windows the last N recorded games", () => {
    // Only 5 recorded games, so L5 == season here.
    expect(at(1.5).cells.l5).toEqual(at(1.5).cells.season);
  });

  it("returns a null hit rate when there is no sample", () => {
    const empty = assembleLineCells([{ value: null, opposingHand: null }], [0.5]);
    expect(empty[0].cells.season).toMatchObject({ sampleSize: 0, hitRate: null });
    expect(empty[0].cells.vsLHP).toMatchObject({ sampleSize: 0, hitRate: null });
  });
});
