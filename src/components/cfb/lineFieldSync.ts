/**
 * The pure decision behind `LineField`'s draft/value sync (CfbGameCard.tsx).
 * Pulled out on its own — no React, no DOM — so the exact bug this fixes
 * (a manual-line input showing a stale value after Clear, after localStorage
 * hydration, or after a cross-tab update) is testable without introducing a
 * DOM-testing dependency (this project has none configured; vitest's
 * environment is plain `node` — see vitest.config.ts). Same "pure logic,
 * dedicated test file" shape as the rest of `src/lib/cfb`.
 */

/**
 * Decides whether a `LineField`'s displayed draft should re-sync from a new
 * committed `value`, called once per render with the value it was last
 * synced from (`syncedValue`).
 *
 * Returns `null` when `value` hasn't moved since the last sync — critically,
 * this includes every render that happens WHILE the user is mid-keystroke
 * (typing only changes the field's own local draft state, never the
 * committed `value` prop, so `value === syncedValue` stays true and this
 * never overwrites an in-progress edit). Returns the new draft/syncedValue
 * pair when `value` DID change for an external reason — Clear (value becomes
 * `null`), the store hydrating from `localStorage` after mount, or a
 * cross-tab `storage` event.
 */
export function resyncDraft(
  value: number | null,
  syncedValue: number | null
): { draft: string; syncedValue: number | null } | null {
  if (value === syncedValue) return null;
  return { draft: value === null ? "" : String(value), syncedValue: value };
}
