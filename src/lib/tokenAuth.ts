/**
 * Scoped owner tokens (Phase 2 A4 / audit S-10).
 *
 * Until now one secret — CRON_SECRET — did everything: it authorized the
 * cron runner, the read-only owner pages (/deck, /models/edges, the Discord
 * preview, all via ?token= URLs that live in browser history and host logs),
 * AND the destructive/posting surfaces (/api/admin/*, the deck's actions).
 * One leaked deck link was full control.
 *
 * The separation, designed to break nothing that exists today:
 *
 *   - Read scope (owner pages): OWNER_READ_TOKEN when configured; the legacy
 *     CRON_SECRET keeps working either way, so every saved link survives.
 *   - Admin scope (destructive + posting: /api/admin/*, deck actions):
 *     ADMIN_TOKEN when configured; until it is, CRON_SECRET works exactly
 *     as today (dormant-identical). Once ADMIN_TOKEN exists, CRON_SECRET
 *     stops authorizing admin via a ?token= URL — the leakable channel —
 *     while still working as a Bearer header for automation.
 *   - Cron scope (checkCronAuth): CRON_SECRET as Bearer, unchanged.
 *
 * Activation is Sam's one step, whenever he chooses: set OWNER_READ_TOKEN
 * and ADMIN_TOKEN in the Vercel env, then point the /deck bookmark at the
 * ADMIN_TOKEN (the deck writes; its actions demand admin scope once the
 * token exists). Read pages keep working with either token throughout.
 * All comparisons are timing-safe.
 */
import { timingSafeEqual } from "node:crypto";

/** Timing-safe string equality; false for missing/empty values or length mismatch. */
export function tokenMatches(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type Env = Record<string, string | undefined>;

/** Read-only owner surfaces: the read token when set, else/always the legacy cron secret. */
export function readTokenOk(provided: string | null | undefined, env: Env = process.env): boolean {
  return tokenMatches(provided, env.OWNER_READ_TOKEN) || tokenMatches(provided, env.CRON_SECRET);
}

/**
 * Destructive/posting surfaces. `via` is how the credential arrived: a
 * query/form token (the channel URLs leak through) or a Bearer header
 * (automation, never written into a browsable URL).
 */
export function adminTokenOk(provided: string | null | undefined, via: "query" | "bearer", env: Env = process.env): boolean {
  if (tokenMatches(provided, env.ADMIN_TOKEN)) return true;
  if (!env.ADMIN_TOKEN) return tokenMatches(provided, env.CRON_SECRET); // dormant: today's behavior
  return via === "bearer" && tokenMatches(provided, env.CRON_SECRET); // activated: cron secret is header-only for admin
}

/** True when at least one secret that could authorize the scope is configured (fail-closed checks). */
export function scopeConfigured(scope: "read" | "admin" | "cron", env: Env = process.env): boolean {
  if (scope === "cron") return Boolean(env.CRON_SECRET);
  if (scope === "read") return Boolean(env.OWNER_READ_TOKEN || env.CRON_SECRET);
  return Boolean(env.ADMIN_TOKEN || env.CRON_SECRET);
}
