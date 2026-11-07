import { describe, expect, it } from "vitest";
import { regimeSnapshot, stableStringify, versionSegment, weightsHash, weightsHashOfSnapshot } from "./modelStamp";

describe("stableStringify / weightsHash", () => {
  it("key order does not change the hash; a changed weight does", () => {
    const a = weightsHash({ points: 0.35, rebounds: 0.5 });
    const b = weightsHash({ rebounds: 0.5, points: 0.35 });
    const c = weightsHash({ points: 0.36, rebounds: 0.5 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });
  it("nested objects are sorted at every depth", () => {
    expect(stableStringify({ b: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"b":{"c":2,"d":1}}');
  });
});

describe("regimeSnapshot", () => {
  it("defaults missing maps to empty and hashes the whole fitted state", () => {
    const snap = regimeSnapshot({ modelWeights: { points: 0.35 } });
    expect(snap.calibrationFactors).toEqual({});
    expect(snap.blendVerdicts).toEqual({});
    expect(snap.weightsHash).toBe(weightsHash({ modelWeights: { points: 0.35 }, calibrationFactors: {}, blendVerdicts: {} }));
  });
  it("the same fitted state fitted again produces the identical snapshot hash", () => {
    const one = regimeSnapshot({ modelWeights: { points: 0.35 }, blendVerdicts: { points: "thin" } });
    const two = regimeSnapshot({ blendVerdicts: { points: "thin" }, modelWeights: { points: 0.35 } });
    expect(one.weightsHash).toBe(two.weightsHash);
  });
});

describe("versionSegment", () => {
  it("unstamped runs segment on the code version alone", () => {
    expect(versionSegment("abc1234", null)).toBe("abc1234");
    expect(versionSegment("abc1234", { something: "else" })).toBe("abc1234");
  });
  it("stamped runs segment on code version + fit hash — a refit on the same code is a new segment", () => {
    const snap = regimeSnapshot({ modelWeights: { points: 0.35 } });
    expect(versionSegment("abc1234", snap)).toBe(`abc1234 · fit ${snap.weightsHash}`);
    const refit = regimeSnapshot({ modelWeights: { points: 0.5 } });
    expect(versionSegment("abc1234", refit)).not.toBe(versionSegment("abc1234", snap));
  });
  it("no version, no segment", () => {
    expect(versionSegment(null, null)).toBeNull();
    expect(versionSegment(undefined, regimeSnapshot({}))).toBeNull();
  });
  it("weightsHashOfSnapshot reads only a string hash", () => {
    expect(weightsHashOfSnapshot({ weightsHash: "deadbeef" })).toBe("deadbeef");
    expect(weightsHashOfSnapshot({ weightsHash: 42 })).toBeNull();
    expect(weightsHashOfSnapshot("nope")).toBeNull();
  });
});
