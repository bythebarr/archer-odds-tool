import { readFileSync } from "node:fs";

/**
 * Pure guard for `migrate:resolve-nhl`: does `prisma migrate status` output
 * report *this exact migration* as failed? The failed entry must be matched
 * as one unit — a migration name appearing anywhere plus the word "failed"
 * appearing anywhere is not enough: a *different* failed migration would
 * then trigger resolving the healthy NHL migration.
 *
 * Two shapes are handled, because the status output's exact wording is not
 * contractual (and `migrate status` offers no --json in Prisma 7.8.0):
 * 1. A "have failed" section listing the migration on its own line (the
 *    shape `migrate status` prints today).
 * 2. A single line carrying both the migration name and a failed state.
 */
export function isMigrationFailed(status: string, migration: string): boolean {
  if (!migration) return false;
  const lines = status.split(/\r?\n/);
  let inFailedSection = false;
  for (const line of lines) {
    if (/have failed/i.test(line)) {
      inFailedSection = true;
      continue;
    }
    if (inFailedSection) {
      if (line.trim() === "" || /^the following/i.test(line)) {
        inFailedSection = false;
      } else if (line.includes(migration)) {
        return true;
      }
      continue;
    }
    if (line.includes(migration) && /failed/i.test(line)) return true;
  }
  return false;
}

// CLI mode (used by scripts/migrate-resolve-nhl.sh): read `migrate status`
// output on stdin, exit 0 iff the named migration is reported as failed.
const invokedAsScript =
  process.argv[1]?.endsWith("migrateStatusGuard.ts") ?? false;
if (invokedAsScript) {
  const status = readFileSync(0, "utf-8");
  process.exitCode = isMigrationFailed(status, process.argv[2] ?? "") ? 0 : 1;
}
