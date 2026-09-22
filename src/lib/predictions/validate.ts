/**
 * The narrow engine/storage boundary for the prediction-history tables (see
 * docs/architecture/MODEL-PREDICTION-LIFECYCLE.md). Pure functions only — no
 * prisma, no I/O, no sport-specific imports — so every future sport's writer
 * goes through the exact same checks before a row is ever created.
 *
 * `validatePredictionRunInput` never throws; it returns a list of human-
 * readable issues (empty = valid). `assertValidPredictionRunInput` is the
 * throw-on-invalid wrapper the storage layer actually calls.
 */
import type { JsonValue, ModelLifecycle, PredictionInput, PredictionRunInput } from "./types";

const LIFECYCLE_VALUES: readonly ModelLifecycle[] = ["experimental", "validated", "production"];

/** Thrown by `assertValidPredictionRunInput`. Carries every issue found, not just the first. */
export class PredictionValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`invalid prediction run: ${issues.join("; ")}`);
    this.name = "PredictionValidationError";
    this.issues = issues;
  }
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function requireNonBlank(value: unknown, field: string, issues: string[]): void {
  if (!isNonBlankString(value)) issues.push(`${field} must be a nonblank string`);
}

/**
 * Recursively verifies a value contains only JSON-serializable data: no
 * `undefined`, functions, symbols, bigints, `Date`s, `NaN`/`Infinity`, sparse
 * array holes, or circular references. Stricter than "won't throw when
 * stringified" — `JSON.stringify` silently drops `undefined` object
 * properties and turns array holes into `null`, both of which are treated
 * here as invalid payloads rather than silent reinterpretation.
 *
 * `seen` tracks the current ANCESTOR path only (added on entry, removed on
 * exit via `finally`) — not every object visited anywhere in the value. A
 * value that legitimately references the same sub-object twice from two
 * different branches (a DAG, not a cycle — e.g. two predictions in one
 * payload pointing at one shared, deduplicated ratings object) is NOT a
 * circular reference and must not be rejected as one; only an object that is
 * its own ancestor is.
 */
export function isJsonSerializable(value: unknown, seen: Set<object> = new Set()): boolean {
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "boolean") return true;
  if (t === "number") return Number.isFinite(value as number);
  if (t !== "object") return false; // undefined, function, symbol, bigint

  const obj = value as object;
  if (obj instanceof Date) return false;
  if (seen.has(obj)) return false; // this object is its own ancestor: a true cycle

  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        if (!(i in obj)) return false; // sparse hole — JSON.stringify would silently turn this into `null`
        if (!isJsonSerializable(obj[i], seen)) return false;
      }
      return true;
    }
    if (Object.getPrototypeOf(obj) !== Object.prototype && Object.getPrototypeOf(obj) !== null) {
      return false; // class instances, Map/Set, etc. — plain objects only
    }
    return Object.values(obj as Record<string, unknown>).every((v) => isJsonSerializable(v, seen));
  } finally {
    seen.delete(obj); // backtrack: this object is no longer an ancestor of sibling branches
  }
}

function checkJsonField(value: JsonValue | undefined, field: string, issues: string[]): void {
  if (value === undefined) return; // optional field, not provided
  if (!isJsonSerializable(value)) issues.push(`${field} must contain only JSON-serializable data`);
}

function checkProbability(value: number | null | undefined, field: string, issues: string[]): void {
  if (value === undefined || value === null) return; // optional
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${field} must be a finite number`);
    return;
  }
  if (value < 0 || value > 1) issues.push(`${field} must be within [0, 1]`);
}

/** `generatedAt`/`dataAsOfUtc` must be strictly BEFORE kickoff — at or after is a leakage risk, not a warning. */
function checkBeforeKickoff(value: Date, field: string, scheduledStartUtc: Date, issues: string[]): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    issues.push(`${field} must be a valid Date`);
    return;
  }
  if (value.getTime() >= scheduledStartUtc.getTime()) {
    issues.push(`${field} (${value.toISOString()}) must be strictly before scheduledStartUtc (${scheduledStartUtc.toISOString()})`);
  }
}

function validatePrediction(p: PredictionInput, index: number, run: PredictionRunInput, issues: string[]): void {
  const label = `predictions[${index}]`;
  requireNonBlank(p.eventRef, `${label}.eventRef`, issues);
  requireNonBlank(p.marketKey, `${label}.marketKey`, issues);
  requireNonBlank(p.selectionKey, `${label}.selectionKey`, issues);

  if (!(p.scheduledStartUtc instanceof Date) || Number.isNaN(p.scheduledStartUtc.getTime())) {
    issues.push(`${label}.scheduledStartUtc must be a valid Date`);
  } else {
    checkBeforeKickoff(run.generatedAt, `${label}: run.generatedAt`, p.scheduledStartUtc, issues);
    checkBeforeKickoff(run.dataAsOfUtc, `${label}: run.dataAsOfUtc`, p.scheduledStartUtc, issues);
  }

  checkProbability(p.probability, `${label}.probability`, issues);

  if (p.featureSnapshot === undefined || p.featureSnapshot === null) {
    issues.push(`${label}.featureSnapshot is required`);
  } else {
    checkJsonField(p.featureSnapshot, `${label}.featureSnapshot`, issues);
  }
  checkJsonField(p.projection, `${label}.projection`, issues);
  checkJsonField(p.missingInputs, `${label}.missingInputs`, issues);
  checkJsonField(p.marketSnapshot, `${label}.marketSnapshot`, issues);
}

function checkDuplicateSelections(predictions: PredictionInput[], issues: string[]): void {
  const seen = new Set<string>();
  predictions.forEach((p, index) => {
    const key = `${p.eventRef}\u0000${p.marketKey}\u0000${p.selectionKey}`;
    if (seen.has(key)) {
      issues.push(
        `predictions[${index}] duplicates an earlier selection in this run (eventRef=${p.eventRef}, marketKey=${p.marketKey}, selectionKey=${p.selectionKey})`
      );
    }
    seen.add(key);
  });
}

/**
 * Validates a full run + its predictions. Never throws. Returns an empty
 * array when the input is valid.
 */
export function validatePredictionRunInput(input: PredictionRunInput): string[] {
  const issues: string[] = [];

  requireNonBlank(input.sportKey, "sportKey", issues);
  requireNonBlank(input.modelKey, "modelKey", issues);
  requireNonBlank(input.modelVersion, "modelVersion", issues);
  requireNonBlank(input.featureSchemaVersion, "featureSchemaVersion", issues);

  // Lifecycle must be an explicit, valid value — never assumed, never
  // silently defaulted to "production" by an absent/blank field.
  if (!isNonBlankString(input.lifecycle) || !LIFECYCLE_VALUES.includes(input.lifecycle as ModelLifecycle)) {
    issues.push(`lifecycle must be explicitly one of: ${LIFECYCLE_VALUES.join(", ")}`);
  }

  const generatedAtValid = input.generatedAt instanceof Date && !Number.isNaN(input.generatedAt.getTime());
  const dataAsOfValid = input.dataAsOfUtc instanceof Date && !Number.isNaN(input.dataAsOfUtc.getTime());
  if (!generatedAtValid) issues.push("generatedAt must be a valid Date");
  if (!dataAsOfValid) issues.push("dataAsOfUtc must be a valid Date");

  // A data-as-of cutoff after the run's own generation time is incoherent —
  // a run cannot claim to have used data "as of" a moment later than when it
  // ran. Equality is fine (the cutoff is the moment of generation).
  if (generatedAtValid && dataAsOfValid && input.dataAsOfUtc.getTime() > input.generatedAt.getTime()) {
    issues.push(
      `dataAsOfUtc (${input.dataAsOfUtc.toISOString()}) must not be after generatedAt (${input.generatedAt.toISOString()})`
    );
  }

  checkJsonField(input.calibrationSnapshot, "calibrationSnapshot", issues);
  checkJsonField(input.runMetadata, "runMetadata", issues);

  if (!Array.isArray(input.predictions) || input.predictions.length === 0) {
    issues.push("predictions must contain at least one entry");
  } else {
    input.predictions.forEach((p, i) => validatePrediction(p, i, input, issues));
    checkDuplicateSelections(input.predictions, issues);
  }

  return issues;
}

/** Throws `PredictionValidationError` (carrying every issue found) when the input is invalid. */
export function assertValidPredictionRunInput(input: PredictionRunInput): void {
  const issues = validatePredictionRunInput(input);
  if (issues.length > 0) throw new PredictionValidationError(issues);
}
