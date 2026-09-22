/**
 * Pure helpers for `capture-cfb-predictions.ts`, split into their own module
 * so they can be unit-tested (`captureCfbArgs.test.ts`) without importing
 * the CLI entry file itself — that file calls `main()` and `process.exit()`
 * at module scope, which would fire during a test import. No Prisma, no
 * network, no `dotenv/config` side effect here.
 */
import { todayEt, isValidEtDate } from "@/lib/dateEt";
import { sanitizeErrorMessage } from "@/lib/engine/ingestResult";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ParsedCaptureArgs {
  dateEt: string;
  confirmRerun: boolean;
}

/**
 * `today` is injected (rather than read via `todayEt()` internally) so this
 * function is deterministically testable — the CLI's real call site always
 * passes the real `todayEt()`.
 */
export function parseArgs(argv: string[], today: string = todayEt()): ParsedCaptureArgs {
  let dateArg: string | null = null;
  let dateArgSeen = false;
  let confirmRerun = false;

  for (const arg of argv) {
    if (arg === "--confirm-rerun") {
      confirmRerun = true;
    } else if (arg.startsWith("--date=")) {
      if (dateArgSeen) {
        throw new Error(`Duplicate --date argument (first "${dateArg}", then "${arg.slice("--date=".length)}"). Pass it once.`);
      }
      dateArgSeen = true;
      dateArg = arg.slice("--date=".length);
    } else {
      throw new Error(`Unrecognized argument "${arg}". Supported: --date=YYYY-MM-DD, --confirm-rerun`);
    }
  }

  if (dateArg === null) {
    return { dateEt: today, confirmRerun };
  }

  if (!DATE_RE.test(dateArg) || !isValidEtDate(dateArg)) {
    throw new Error(`Invalid --date "${dateArg}" — expected a real YYYY-MM-DD date.`);
  }
  // Temporal integrity requires every prediction to predate its own kickoff —
  // a PAST date can only ever contain games that have already started or
  // finished, which the collector would then legitimately exclude down to
  // zero anyway. Rejecting up front gives a clearer error than a silent
  // "nothing eligible."
  if (dateArg < today) {
    throw new Error(`--date=${dateArg} is in the past (today is ${today} ET). CFB forward capture only accepts today or a future date.`);
  }
  return { dateEt: dateArg, confirmRerun };
}

/** Strips a Postgres connection string (which can carry DATABASE_URL's own credentials) before anything reaches stdout — `sanitizeErrorMessage` doesn't cover this shape (see its own docstring), so this is layered in addition to it. */
export function redactConnectionStrings(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]");
}

export function safeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return sanitizeErrorMessage(redactConnectionStrings(raw));
}

export function summarizeExclusions(exclusions: { reason: string }[]): string {
  const counts = new Map<string, number>();
  for (const e of exclusions) counts.set(e.reason, (counts.get(e.reason) ?? 0) + 1);
  if (counts.size === 0) return "  (none)";
  return [...counts.entries()].map(([reason, n]) => `  ${reason}: ${n}`).join("\n");
}
