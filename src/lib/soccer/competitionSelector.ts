/**
 * Which soccer competitions the dedicated pipeline polls (Phase 2 D2).
 *
 * The pipeline froze in July 2026 because its allowlist was one hand-kept
 * constant — the World Cup — and the design's maintenance step ("update by
 * hand once the tournament ends") never happened; the polls were never in
 * the tick schedule either, so the dead state raised no signal. This pure
 * selector replaces the hand-kept constant: from the provider's free sports
 * list (already fetched by ingest's resolver), take the active competitions
 * from an evergreen preference list, in preference order, capped.
 *
 * The CAP is a credit decision and stays Sam's: one key costs 2 credits per
 * poll call (1 market × 2 regions), and soccer has 30+ active keys at peak.
 * This module is deliberately not wired into ingest yet — wiring it (and
 * adding the poll to the tick schedule) is the activation step that spends
 * those credits, and it lands with Sam's cap number.
 */

/** The shape of one entry in the provider's sports list (oddsApiClient). */
export interface SportListEntry {
  key: string;
  active: boolean;
  has_outrights?: boolean;
}

/** Evergreen competitions, most valuable first. World Cup stays on the list — in its years it outranks everything. */
export const SOCCER_PREFERENCE: string[] = [
  "soccer_fifa_world_cup",
  "soccer_uefa_champs_league",
  "soccer_epl",
  "soccer_spain_la_liga",
  "soccer_italy_serie_a",
  "soccer_germany_bundesliga",
  "soccer_france_ligue_1",
  "soccer_usa_mls",
  "soccer_uefa_europa_league",
  "soccer_mexico_ligamx",
];

/** Active competitions from the preference list, in preference order, at most `cap`. Pure. */
export function pickActiveSoccerKeys(sports: SportListEntry[], cap: number, preference: string[] = SOCCER_PREFERENCE): string[] {
  if (cap <= 0) return [];
  const active = new Set(sports.filter((s) => s.active).map((s) => s.key));
  return preference.filter((key) => active.has(key)).slice(0, cap);
}
