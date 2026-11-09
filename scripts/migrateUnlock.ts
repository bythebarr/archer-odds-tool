/**
 * Pure helpers for `migrate:unlock` (`scripts/migrate-unlock.ts`).
 *
 * The exit-code rule, pinned by `migrateUnlock.test.ts`: a run ends 0 only
 * once no session still holds the Prisma migrate lock. If holders remain
 * after the wait, the run must fail — otherwise the Model lab workflow
 * reports success while the lock persists, and the next deploy times out
 * again (P1002) with no signal that anything went wrong.
 */
export function unlockExitCode(holdersLeft: number): 0 | 1 {
  return holdersLeft > 0 ? 1 : 0;
}
