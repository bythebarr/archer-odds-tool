import { describe, it, expect } from "vitest";
import { validatePredictionRunInput, assertValidPredictionRunInput, isJsonSerializable, PredictionValidationError } from "./validate";
import type { PredictionInput, PredictionRunInput } from "./types";

/**
 * Pure validation logic for the prediction-history storage boundary (see
 * docs/architecture/MODEL-PREDICTION-LIFECYCLE.md). No prisma/I/O here — the
 * storage layer (store.ts) isn't tested with a DB mock, matching this
 * codebase's existing convention of testing only pure functions
 * (docs/architecture/EDGE-BASELINE-AUDIT.md's Step 2 remediation notes no
 * `vi.mock` usage exists anywhere in this repo).
 */

const KICKOFF = new Date("2026-09-27T17:00:00.000Z");
const BEFORE_KICKOFF = new Date("2026-09-27T12:00:00.000Z");
const EARLIER = new Date("2026-09-26T12:00:00.000Z");

function validPrediction(overrides: Partial<PredictionInput> = {}): PredictionInput {
  return {
    eventRef: "espn-401628345",
    scheduledStartUtc: KICKOFF,
    marketKey: "h2h",
    selectionKey: "home",
    probability: 0.61,
    featureSnapshot: { offenseRating: 4.2, defenseRating: -1.1 },
    ...overrides,
  };
}

function validRun(overrides: Partial<PredictionRunInput> = {}): PredictionRunInput {
  return {
    sportKey: "cfb",
    modelKey: "cfb-srs",
    modelVersion: "2026.09.19",
    lifecycle: "experimental",
    generatedAt: BEFORE_KICKOFF,
    dataAsOfUtc: EARLIER,
    featureSchemaVersion: "v1",
    predictions: [validPrediction()],
    ...overrides,
  };
}

describe("validatePredictionRunInput — valid input", () => {
  it("a well-formed run has no issues", () => {
    expect(validatePredictionRunInput(validRun())).toEqual([]);
  });

  it("accepts a run with no probability, projection, or optional JSON fields", () => {
    const run = validRun({
      predictions: [validPrediction({ probability: null, projection: undefined, missingInputs: undefined, marketSnapshot: undefined })],
    });
    expect(validatePredictionRunInput(run)).toEqual([]);
  });

  it("assertValidPredictionRunInput does not throw on valid input", () => {
    expect(() => assertValidPredictionRunInput(validRun())).not.toThrow();
  });
});

describe("probability validation", () => {
  it("rejects a probability below 0", () => {
    const issues = validatePredictionRunInput(validRun({ predictions: [validPrediction({ probability: -0.01 })] }));
    expect(issues.some((i) => i.includes("probability"))).toBe(true);
  });

  it("rejects a probability above 1", () => {
    const issues = validatePredictionRunInput(validRun({ predictions: [validPrediction({ probability: 1.5 })] }));
    expect(issues.some((i) => i.includes("probability"))).toBe(true);
  });

  it("rejects NaN", () => {
    const issues = validatePredictionRunInput(validRun({ predictions: [validPrediction({ probability: NaN })] }));
    expect(issues.some((i) => i.includes("probability"))).toBe(true);
  });

  it("rejects Infinity", () => {
    const issues = validatePredictionRunInput(validRun({ predictions: [validPrediction({ probability: Infinity })] }));
    expect(issues.some((i) => i.includes("probability"))).toBe(true);
  });

  it("accepts the boundary values 0 and 1", () => {
    expect(validatePredictionRunInput(validRun({ predictions: [validPrediction({ probability: 0 })] }))).toEqual([]);
    expect(validatePredictionRunInput(validRun({ predictions: [validPrediction({ probability: 1 })] }))).toEqual([]);
  });
});

describe("required identity/version strings", () => {
  it("rejects a blank sportKey", () => {
    expect(validatePredictionRunInput(validRun({ sportKey: "" })).some((i) => i.includes("sportKey"))).toBe(true);
  });
  it("rejects a whitespace-only modelKey", () => {
    expect(validatePredictionRunInput(validRun({ modelKey: "   " })).some((i) => i.includes("modelKey"))).toBe(true);
  });
  it("rejects a missing modelVersion", () => {
    expect(validatePredictionRunInput(validRun({ modelVersion: undefined })).some((i) => i.includes("modelVersion"))).toBe(true);
  });
  it("rejects a blank featureSchemaVersion", () => {
    expect(validatePredictionRunInput(validRun({ featureSchemaVersion: "" })).some((i) => i.includes("featureSchemaVersion"))).toBe(true);
  });
  it("rejects a blank eventRef", () => {
    const issues = validatePredictionRunInput(validRun({ predictions: [validPrediction({ eventRef: "" })] }));
    expect(issues.some((i) => i.includes("eventRef"))).toBe(true);
  });
  it("rejects a blank marketKey", () => {
    const issues = validatePredictionRunInput(validRun({ predictions: [validPrediction({ marketKey: "" })] }));
    expect(issues.some((i) => i.includes("marketKey"))).toBe(true);
  });
  it("rejects a blank selectionKey", () => {
    const issues = validatePredictionRunInput(validRun({ predictions: [validPrediction({ selectionKey: "" })] }));
    expect(issues.some((i) => i.includes("selectionKey"))).toBe(true);
  });
});

describe("data-as-of cutoff vs. kickoff", () => {
  it("rejects dataAsOfUtc exactly at kickoff", () => {
    const issues = validatePredictionRunInput(validRun({ dataAsOfUtc: KICKOFF }));
    expect(issues.some((i) => i.includes("dataAsOfUtc"))).toBe(true);
  });
  it("rejects dataAsOfUtc after kickoff", () => {
    const after = new Date(KICKOFF.getTime() + 1000);
    const issues = validatePredictionRunInput(validRun({ dataAsOfUtc: after }));
    expect(issues.some((i) => i.includes("dataAsOfUtc"))).toBe(true);
  });
  it("accepts dataAsOfUtc strictly before kickoff", () => {
    expect(validatePredictionRunInput(validRun({ dataAsOfUtc: EARLIER }))).toEqual([]);
  });
});

describe("generatedAt vs. kickoff", () => {
  it("rejects generatedAt exactly at kickoff", () => {
    const issues = validatePredictionRunInput(validRun({ generatedAt: KICKOFF }));
    expect(issues.some((i) => i.includes("generatedAt"))).toBe(true);
  });
  it("rejects generatedAt after kickoff", () => {
    const after = new Date(KICKOFF.getTime() + 1000);
    const issues = validatePredictionRunInput(validRun({ generatedAt: after }));
    expect(issues.some((i) => i.includes("generatedAt"))).toBe(true);
  });
});

describe("duplicate selections within one run", () => {
  it("rejects two predictions with the same event/market/selection", () => {
    const issues = validatePredictionRunInput(
      validRun({ predictions: [validPrediction(), validPrediction()] })
    );
    expect(issues.some((i) => i.includes("duplicates"))).toBe(true);
  });

  it("allows the same event with a different marketKey", () => {
    const issues = validatePredictionRunInput(
      validRun({
        predictions: [validPrediction({ marketKey: "h2h" }), validPrediction({ marketKey: "spreads" })],
      })
    );
    expect(issues).toEqual([]);
  });

  it("allows the same event/market with a different selectionKey", () => {
    const issues = validatePredictionRunInput(
      validRun({
        predictions: [validPrediction({ selectionKey: "home" }), validPrediction({ selectionKey: "away" })],
      })
    );
    expect(issues).toEqual([]);
  });
});

describe("multiple distinct revisions are conceptually allowed", () => {
  it("two separate, independently-valid runs for the identical event/market/selection both validate cleanly", () => {
    // Revision behavior lives at the storage layer (a later run is a new row,
    // never an overwrite — see PredictionRun's schema docstring); validation
    // itself must not treat "another run already covers this selection" as
    // an error, since it has no visibility into other runs at all.
    const runA = validRun({ modelVersion: "2026.09.19", predictions: [validPrediction({ probability: 0.55 })] });
    const runB = validRun({ modelVersion: "2026.09.20", predictions: [validPrediction({ probability: 0.58 })] });
    expect(validatePredictionRunInput(runA)).toEqual([]);
    expect(validatePredictionRunInput(runB)).toEqual([]);
  });
});

describe("unserializable / non-finite JSON payloads", () => {
  it("isJsonSerializable rejects NaN nested in an object", () => {
    expect(isJsonSerializable({ margin: NaN })).toBe(false);
  });
  it("isJsonSerializable rejects Infinity", () => {
    expect(isJsonSerializable({ total: Infinity })).toBe(false);
  });
  it("isJsonSerializable rejects a function value", () => {
    expect(isJsonSerializable({ fn: () => 1 })).toBe(false);
  });
  it("isJsonSerializable rejects an explicit undefined value", () => {
    expect(isJsonSerializable({ maybe: undefined })).toBe(false);
  });
  it("isJsonSerializable rejects a Date instance", () => {
    expect(isJsonSerializable({ when: new Date() })).toBe(false);
  });
  it("isJsonSerializable rejects a circular reference", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(isJsonSerializable(obj)).toBe(false);
  });
  it("isJsonSerializable accepts nested plain objects/arrays of primitives", () => {
    expect(isJsonSerializable({ a: [1, 2, { b: "x", c: null, d: true }] })).toBe(true);
  });

  it("validatePredictionRunInput flags a non-finite value inside featureSnapshot", () => {
    const issues = validatePredictionRunInput(
      validRun({ predictions: [validPrediction({ featureSnapshot: { rating: NaN } })] })
    );
    expect(issues.some((i) => i.includes("featureSnapshot"))).toBe(true);
  });

  it("validatePredictionRunInput flags an unserializable calibrationSnapshot", () => {
    const issues = validatePredictionRunInput(validRun({ calibrationSnapshot: { verdict: undefined as never } }));
    expect(issues.some((i) => i.includes("calibrationSnapshot"))).toBe(true);
  });

  it("requires featureSnapshot to be present", () => {
    const issues = validatePredictionRunInput(
      validRun({ predictions: [validPrediction({ featureSnapshot: undefined })] })
    );
    expect(issues.some((i) => i.includes("featureSnapshot"))).toBe(true);
  });
});

describe("lifecycle validation", () => {
  it("rejects a missing lifecycle", () => {
    const issues = validatePredictionRunInput(validRun({ lifecycle: undefined }));
    expect(issues.some((i) => i.includes("lifecycle"))).toBe(true);
  });

  it("rejects a blank lifecycle", () => {
    // @ts-expect-error deliberately violating the type to test the runtime guard
    const issues = validatePredictionRunInput(validRun({ lifecycle: "" }));
    expect(issues.some((i) => i.includes("lifecycle"))).toBe(true);
  });

  it("rejects an invalid lifecycle string, including a caller trying to sneak in 'production'-adjacent text", () => {
    // @ts-expect-error deliberately violating the type to test the runtime guard
    const issues = validatePredictionRunInput(validRun({ lifecycle: "prod" }));
    expect(issues.some((i) => i.includes("lifecycle"))).toBe(true);
  });

  it("accepts each of the three explicit lifecycle values", () => {
    for (const lifecycle of ["experimental", "validated", "production"] as const) {
      expect(validatePredictionRunInput(validRun({ lifecycle }))).toEqual([]);
    }
  });
});

describe("assertValidPredictionRunInput", () => {
  it("throws PredictionValidationError carrying every issue found", () => {
    const bad = validRun({ sportKey: "", modelKey: "", predictions: [validPrediction({ probability: 5 })] });
    expect(() => assertValidPredictionRunInput(bad)).toThrow(PredictionValidationError);

    let caught: unknown;
    try {
      assertValidPredictionRunInput(bad);
    } catch (err) {
      caught = err;
    }
    const issues = (caught as PredictionValidationError).issues;
    expect(issues.some((i) => i.includes("sportKey"))).toBe(true);
    expect(issues.some((i) => i.includes("modelKey"))).toBe(true);
    expect(issues.some((i) => i.includes("probability"))).toBe(true);
  });
});

describe("predictions array", () => {
  it("rejects a run with zero predictions", () => {
    const issues = validatePredictionRunInput(validRun({ predictions: [] }));
    expect(issues.some((i) => i.includes("predictions"))).toBe(true);
  });
});

/**
 * Added by the adversarial review pass. Covers: dataAsOf <= generatedAt,
 * invalid Date rejection across all three timestamp fields, whitespace-only
 * identity strings on every identity field, exact-match (non-normalizing)
 * duplicate detection, and a full JSON-attack surface (bigint, symbol, class
 * instances, sparse arrays, non-circular shared references, deeply nested
 * non-finite numbers).
 */

describe("dataAsOfUtc vs. generatedAt", () => {
  it("rejects dataAsOfUtc after generatedAt", () => {
    const after = new Date(BEFORE_KICKOFF.getTime() + 1000);
    const issues = validatePredictionRunInput(validRun({ generatedAt: BEFORE_KICKOFF, dataAsOfUtc: after }));
    expect(issues.some((i) => i.includes("dataAsOfUtc") && i.includes("generatedAt"))).toBe(true);
  });

  it("accepts dataAsOfUtc exactly equal to generatedAt", () => {
    const issues = validatePredictionRunInput(validRun({ generatedAt: BEFORE_KICKOFF, dataAsOfUtc: BEFORE_KICKOFF }));
    expect(issues).toEqual([]);
  });

  it("accepts dataAsOfUtc strictly before generatedAt", () => {
    expect(validatePredictionRunInput(validRun({ generatedAt: BEFORE_KICKOFF, dataAsOfUtc: EARLIER }))).toEqual([]);
  });

  it("does not report the dataAsOf-vs-generatedAt comparison when either date is itself invalid", () => {
    const issues = validatePredictionRunInput(validRun({ generatedAt: new Date("not-a-date") }));
    expect(issues.some((i) => i.includes("must not be after"))).toBe(false);
    expect(issues.some((i) => i.includes("generatedAt must be a valid Date"))).toBe(true);
  });
});

describe("invalid Date values", () => {
  it("rejects an invalid generatedAt", () => {
    const issues = validatePredictionRunInput(validRun({ generatedAt: new Date("not-a-date") }));
    expect(issues.some((i) => i === "generatedAt must be a valid Date")).toBe(true);
  });

  it("rejects an invalid dataAsOfUtc", () => {
    const issues = validatePredictionRunInput(validRun({ dataAsOfUtc: new Date("not-a-date") }));
    expect(issues.some((i) => i === "dataAsOfUtc must be a valid Date")).toBe(true);
  });

  it("rejects an invalid scheduledStartUtc", () => {
    const issues = validatePredictionRunInput(
      validRun({ predictions: [validPrediction({ scheduledStartUtc: new Date("not-a-date") })] })
    );
    expect(issues.some((i) => i.includes("scheduledStartUtc must be a valid Date"))).toBe(true);
  });

  it("rejects a non-Date value smuggled in as a timestamp", () => {
    // @ts-expect-error deliberately violating the type to test the runtime guard
    const issues = validatePredictionRunInput(validRun({ generatedAt: "2026-09-27T12:00:00.000Z" }));
    expect(issues.some((i) => i.includes("generatedAt must be a valid Date"))).toBe(true);
  });
});

describe("whitespace-only identity strings, every identity field", () => {
  it.each([
    ["sportKey", { sportKey: "   " }],
    ["modelKey", { modelKey: "\t" }],
    ["modelVersion", { modelVersion: "\n" }],
    ["featureSchemaVersion", { featureSchemaVersion: "  " }],
  ] as const)("rejects a whitespace-only %s", (field, override) => {
    const issues = validatePredictionRunInput(validRun(override));
    expect(issues.some((i) => i.includes(field))).toBe(true);
  });

  it.each([
    ["eventRef", { eventRef: "   " }],
    ["marketKey", { marketKey: "\t" }],
    ["selectionKey", { selectionKey: "\n" }],
  ] as const)("rejects a whitespace-only %s", (field, override) => {
    const issues = validatePredictionRunInput(validRun({ predictions: [validPrediction(override)] }));
    expect(issues.some((i) => i.includes(field))).toBe(true);
  });
});

describe("duplicate detection is exact-match, not normalized", () => {
  it("does NOT dedupe a selectionKey that differs only by trailing whitespace", () => {
    const issues = validatePredictionRunInput(
      validRun({
        predictions: [validPrediction({ selectionKey: "home" }), validPrediction({ selectionKey: "home " })],
      })
    );
    expect(issues.some((i) => i.includes("duplicates"))).toBe(false);
  });

  it("does NOT dedupe an eventRef that differs only by case", () => {
    const issues = validatePredictionRunInput(
      validRun({
        predictions: [validPrediction({ eventRef: "ESPN-1" }), validPrediction({ eventRef: "espn-1" })],
      })
    );
    expect(issues.some((i) => i.includes("duplicates"))).toBe(false);
  });
});

describe("JSON attack surface", () => {
  it("rejects bigint", () => {
    expect(isJsonSerializable({ n: BigInt(10) })).toBe(false);
  });

  it("rejects symbol", () => {
    expect(isJsonSerializable({ s: Symbol("x") })).toBe(false);
  });

  it("rejects a non-plain class instance", () => {
    class Rating {
      value = 4.2;
    }
    expect(isJsonSerializable({ rating: new Rating() })).toBe(false);
  });

  it("rejects a Map/Set instance", () => {
    expect(isJsonSerializable({ m: new Map() })).toBe(false);
    expect(isJsonSerializable({ s: new Set() })).toBe(false);
  });

  it("rejects a sparse array (a real hole, not an explicit undefined element)", () => {
    const sparse = [1, , 3];
    expect(isJsonSerializable(sparse)).toBe(false);
  });

  it("still rejects an explicit undefined array element (not a hole)", () => {
    expect(isJsonSerializable([1, undefined, 3])).toBe(false);
  });

  it("rejects NaN/Infinity nested inside an array inside an object", () => {
    expect(isJsonSerializable({ points: [10, 20, NaN] })).toBe(false);
    expect(isJsonSerializable({ points: [10, 20, Infinity] })).toBe(false);
    expect(isJsonSerializable({ points: [10, -Infinity, 30] })).toBe(false);
  });

  it("rejects a non-finite number several levels deep", () => {
    expect(isJsonSerializable({ a: { b: { c: [{ d: NaN }] } } })).toBe(false);
  });

  it("ACCEPTS the same non-circular sub-object referenced twice (a DAG, not a cycle)", () => {
    const shared = { rating: 4.2 };
    expect(isJsonSerializable({ home: shared, away: shared })).toBe(true);
  });

  it("still rejects a true self-reference", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(isJsonSerializable(obj)).toBe(false);
  });

  it("still rejects an indirect cycle (a -> b -> a)", () => {
    const a: Record<string, unknown> = { name: "a" };
    const b: Record<string, unknown> = { name: "b", parent: a };
    a.child = b;
    expect(isJsonSerializable(a)).toBe(false);
  });

  it("validatePredictionRunInput surfaces a bigint inside marketSnapshot", () => {
    const issues = validatePredictionRunInput(
      validRun({ predictions: [validPrediction({ marketSnapshot: { spread: BigInt(3) as unknown as number } })] })
    );
    expect(issues.some((i) => i.includes("marketSnapshot"))).toBe(true);
  });
});
