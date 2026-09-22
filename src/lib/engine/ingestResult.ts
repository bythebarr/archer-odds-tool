/**
 * Shared helpers for the truthful-ingestion contract (Step 2 of the platform
 * recovery — see docs/architecture/EDGE-BASELINE-AUDIT.md's "Step 2
 * remediation" section). One classifier, one error-to-summary path, used by
 * every adapter's `ingest()` and every cron route that reports on one, so
 * "ok" always means the same thing everywhere it appears.
 */
import type { IngestCounts, IngestStatus, IngestSummary } from "./types";
export type { IngestCounts, IngestStatus, IngestSummary };

/** True only for statuses that mean "this run produced/confirmed current data". */
export function isFreshStatus(status: IngestStatus): boolean {
  return status === "ok" || status === "empty";
}

/**
 * Build an `IngestSummary`, deriving the legacy `ok` boolean from `status` so
 * every call site gets the same rule rather than picking its own.
 */
export function buildIngestSummary(
  sportKey: string,
  status: IngestStatus,
  detail: string,
  counts?: IngestCounts,
  extra?: Record<string, unknown>
): IngestSummary {
  return {
    sportKey,
    status,
    ok: isFreshStatus(status),
    detail,
    ...(counts ? { counts } : {}),
    ...extra,
  };
}

/**
 * The common "fetched N from the provider, stored M of them" shape shared by
 * every odds/schedule/results poll in this codebase. Classifies the outcome
 * WITHOUT deciding what "fetched"/"stored" mean for a given sport — the
 * caller maps its own summary's fields onto these first (see each adapter's
 * `ingest()` for the mapping).
 *
 * - fetched === 0            → "empty": nothing to do, not a failure.
 * - fetched > 0, stored === 0 → "unusable": the provider answered but nothing
 *   usable came of it — the exact case a bare `ok: true` used to hide.
 * - otherwise                → "ok".
 */
export function classifyFetchStore(
  counts: IngestCounts,
  opts: { noun?: string; emptyDetail?: string } = {}
): { status: IngestStatus; detail: string } {
  const noun = opts.noun ?? "items";
  const fetched = counts.fetched ?? 0;
  const stored = counts.stored ?? 0;

  if (fetched === 0) {
    return { status: "empty", detail: opts.emptyDetail ?? `0 ${noun} available` };
  }
  if (stored === 0) {
    return { status: "unusable", detail: `provider returned ${fetched} ${noun} but 0 were stored` };
  }
  const rejectedNote = counts.rejected ? `, ${counts.rejected} rejected` : "";
  return { status: "ok", detail: `stored ${stored} of ${fetched} ${noun}${rejectedNote}` };
}

/**
 * UFC-specific classification. UFC's counts are NOT a same-unit fetched/stored
 * pair the way every other sport's is: `eventsProcessed` counts events, while
 * `boutsProcessed` counts bouts, and an event's bout count is incremented
 * BEFORE its bouts are even looked at (see backfillUfc.ts's `ingestEvent`) —
 * so "N events processed, 0 bouts stored" is the ORDINARY shape of an event
 * whose card hasn't been announced yet (`citoEvent.bouts` empty), not
 * evidence of anything going wrong. The only real evidence that usable data
 * existed and couldn't be stored is `rejected > 0` — a bout entry that WAS in
 * the payload but was missing corner data (`skippedBouts`). Do not fold this
 * into `classifyFetchStore`'s generic fetched/stored comparison.
 */
export function classifyUfcIngest(counts: {
  eventsProcessed: number;
  boutsProcessed: number;
  rejected: number;
}): { status: IngestStatus; detail: string } {
  const { eventsProcessed, boutsProcessed, rejected } = counts;
  if (eventsProcessed === 0) {
    return { status: "empty", detail: "no new/updated events this cycle" };
  }
  if (boutsProcessed === 0 && rejected > 0) {
    return {
      status: "unusable",
      detail: `${eventsProcessed} event(s) returned but all ${rejected} bout(s) were unresolvable`,
    };
  }
  const rejectedNote = rejected ? `, ${rejected} rejected` : "";
  return {
    status: "ok",
    detail: `${eventsProcessed} event(s) processed, ${boutsProcessed} bout(s) stored${rejectedNote}`,
  };
}

/** Matches this codebase's own "<VAR>_API_KEY is not set" throws (oddsApiClient.ts, citoApiClient.ts). */
const CONFIG_ERROR_PATTERN = /\b[A-Z][A-Z0-9_]*_API_KEY is not set\b/;

export function isConfigError(message: string): boolean {
  return CONFIG_ERROR_PATTERN.test(message);
}

/** Query-string credential leaks (?apiKey=..., &token=..., ...) to scrub before a message is logged or returned. */
const SECRET_QUERY_PARAM_PATTERN = /([?&](?:api[_-]?key|apikey|key|token|secret|authorization)=)[^&\s"']+/gi;

/** Header/inline-style leaks ("Authorization: Bearer xyz", "authorization=xyz"). */
const SECRET_HEADER_PATTERN = /((?:authorization)\s*[:=]\s*)(?:Bearer\s+)?\S+/gi;
/** A bare "Bearer xyz" token with no "Authorization:" label in front of it. */
const BARE_BEARER_PATTERN = /\bBearer\s+\S+/gi;

/**
 * Make a caught error's message safe to log/return: strip anything that looks
 * like a credential in a query string or an Authorization/Bearer value, and
 * cap the length (a provider's raw error body can otherwise dump an
 * arbitrarily long, unvetted response). Does not attempt to scrub arbitrary
 * secrets it has no pattern for (e.g. a raw DB connection string embedded in
 * a driver error) — that class of leak predates this helper and is out of
 * scope here.
 */
export function sanitizeErrorMessage(message: string, maxLength = 300): string {
  const redacted = message
    .replace(SECRET_QUERY_PARAM_PATTERN, "$1[redacted]")
    .replace(SECRET_HEADER_PATTERN, "$1[redacted]")
    .replace(BARE_BEARER_PATTERN, "Bearer [redacted]");
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
}

/**
 * Turn a caught error into an `IngestSummary` — never throws, never leaks a
 * secret. Missing/disabled provider configuration (this codebase's own
 * "X_API_KEY is not set" throws) reads as "skipped", not "error": it's an
 * expected, actionable state (set the key), not a broken run.
 */
export function summaryForCaughtError(
  sportKey: string,
  error: unknown,
  extra?: Record<string, unknown>
): IngestSummary {
  const message = error instanceof Error ? error.message : String(error);
  const safeMessage = sanitizeErrorMessage(message);
  const status: IngestStatus = isConfigError(safeMessage) ? "skipped" : "error";
  return buildIngestSummary(sportKey, status, safeMessage, undefined, extra);
}

/** HTTP status a cron route should return for a given outcome — non-2xx only for a genuine failure. */
export function ingestHttpStatus(status: IngestStatus): number {
  return status === "unusable" || status === "error" ? 502 : 200;
}

/**
 * PollLog-friendly one-line status string. Keeps the "error:" prefix
 * convention `writeOutcomeStatus` already established (see pollingPolicy.ts —
 * /api/status is scanned for that prefix), so "unusable" and "error" both
 * surface the same way a plain thrown error always has.
 */
export function pollLogStatus(summary: Pick<IngestSummary, "status" | "detail">): string {
  switch (summary.status) {
    case "ok":
      return `ok (${summary.detail})`;
    case "empty":
      return `ok (empty: ${summary.detail})`;
    case "skipped":
      return `skipped: ${summary.detail}`;
    case "unusable":
    case "error":
      return `error: ${summary.detail}`;
  }
}
