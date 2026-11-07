/**
 * Model-regime stamping for tracked leans (Phase 2 A3 / audit S-9 + §3-A).
 *
 * A lean's run already freezes the code version (git SHA). What it never
 * froze was the FITTED state — the blend weights, calibration factors, and
 * trust verdicts in force when the lean was made, all re-fitted by hand-run
 * scripts at unknown dates. Two runs on the same SHA could therefore be
 * different models, and no breakdown could separate "the model changed"
 * from "the model drifted". Capture now stamps each props run's
 * calibrationSnapshot with a regime snapshot of exactly those parameters
 * plus a hash of them; readers join run.modelVersion + this hash into a
 * version segment, and evaluation cuts on it.
 */

/** JSON with object keys sorted at every depth, so a hash means the values, not their order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** FNV-1a (32-bit) over the stable string form — deterministic, dependency-free. */
export function weightsHash(input: unknown): string {
  const s = stableStringify(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The fitted state in force for one capture run, frozen onto its PredictionRun. */
export interface RegimeSnapshot {
  modelWeights: Record<string, number | null>;
  calibrationFactors: Record<string, number | null>;
  blendVerdicts: Record<string, string>;
  /** Hash of the three maps above: same fitted state, same hash, whatever the key order. */
  weightsHash: string;
}

export function regimeSnapshot(input: {
  modelWeights?: Record<string, number | null>;
  calibrationFactors?: Record<string, number | null>;
  blendVerdicts?: Record<string, string>;
}): RegimeSnapshot {
  const modelWeights = input.modelWeights ?? {};
  const calibrationFactors = input.calibrationFactors ?? {};
  const blendVerdicts = input.blendVerdicts ?? {};
  return { modelWeights, calibrationFactors, blendVerdicts, weightsHash: weightsHash({ modelWeights, calibrationFactors, blendVerdicts }) };
}

/** The weightsHash inside a stored calibrationSnapshot, when the run was regime-stamped. */
export function weightsHashOfSnapshot(snapshot: unknown): string | null {
  if (snapshot && typeof snapshot === "object" && "weightsHash" in snapshot) {
    const h = (snapshot as { weightsHash?: unknown }).weightsHash;
    return typeof h === "string" ? h : null;
  }
  return null;
}

/**
 * The segment a lean belongs to for version cuts: the code version alone
 * for unstamped runs, code version + fitted-state hash for stamped ones.
 * Null when the run carried no version at all.
 */
export function versionSegment(modelVersion: string | null | undefined, snapshot: unknown): string | null {
  if (!modelVersion) return null;
  const h = weightsHashOfSnapshot(snapshot);
  return h ? `${modelVersion} · fit ${h}` : modelVersion;
}
