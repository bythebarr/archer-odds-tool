/**
 * Each pre-built pool's health for /api/status: when it was last built, how
 * old that is, whether a build holds its claim (and whether that claim is
 * abandoned), the last build error, and the rows stored. A pool that stops
 * rebuilding used to be visible only as yesterday's slate on the screener;
 * here it reads "stale" with its age and the error that stopped it. Pure.
 */
import { CLAIM_TTL_MS, POOL_STALE_MS } from "./snapshot";

export interface PoolMeta {
  key: string;
  builtAt: Date | null;
  buildingSince: Date | null;
  error: string | null;
  rows: number;
}

export interface PoolHealth {
  pool: string;
  builtAt: string | null;
  ageMinutes: number | null;
  rows: number;
  /** "fresh" inside POOL_STALE_MS; "stale" past it; "never built". */
  state: "fresh" | "stale" | "never built";
  /** A build in flight, or one that died holding the claim (older than CLAIM_TTL_MS). */
  claim: { since: string; abandoned: boolean } | null;
  /** The last failed build's message; cleared by the next good build. */
  error: string | null;
}

/** A pool's meta row is the pool key itself ("screener:nba"); chunk rows add ":<part>:<i>". */
export const isPoolMetaKey = (key: string) => key.split(":").length === 2;

export function poolHealth(metas: PoolMeta[], now = Date.now()): PoolHealth[] {
  return metas
    .filter((m) => isPoolMetaKey(m.key))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((m) => {
      const age = m.builtAt ? now - m.builtAt.getTime() : null;
      return {
        pool: m.key,
        builtAt: m.builtAt?.toISOString() ?? null,
        ageMinutes: age === null ? null : Math.round(age / 60_000),
        rows: m.rows,
        state: age === null ? "never built" : age > POOL_STALE_MS ? "stale" : "fresh",
        claim: m.buildingSince ? { since: m.buildingSince.toISOString(), abandoned: now - m.buildingSince.getTime() > CLAIM_TTL_MS } : null,
        error: m.error,
      };
    });
}
