/**
 * The sport registry's CLIENT-SAFE half: sport identity + display metadata, as
 * pure data with zero server imports. The heavy `SportAdapter`s (which pull in
 * prisma + ingest code) reference their entry here via `meta`, so this stays the
 * ONE source of sport identity/display while remaining importable from client
 * components (nav bars, the odds board) without dragging server code into the
 * browser bundle. See docs/architecture/sport-engine.md (Phase 3d).
 *
 * The sport-key unions (`SportKey`/`SlateSport`/`NavSport`) DERIVE from this list
 * — the entries are the source, not a hand-kept parallel type. Adding a sport is
 * a single entry here (plus its adapter in registry.ts).
 */
import type { SportMeta } from "./types";
export type { SportMeta };

// `as const` keeps the literals so the unions below derive; `satisfies` checks
// each entry's shape. Order is display order (MLB primary first) — nav, the Home
// launcher, and the SportRail all render in it. `resultsOnly` and `signalOnly`
// are set explicitly on every entry (not just the sports that need them) so both
// are readable on the literal union at runtime.
export const SPORT_METAS = [
  { sport: "mlb", label: "MLB", icon: "⚾", href: "/mlb", accent: "#3b82f6", carriesDate: true, resultsOnly: false, signalOnly: false },
  // Fully tracked: ESPN's free scoreboard is NFL's results authority (see
  // nfl/results.ts), so games settle and plays grade like MLB's.
  { sport: "nfl", label: "NFL", icon: "🏈", href: "/nfl", accent: "#f59e0b", carriesDate: false, resultsOnly: false, signalOnly: false },
  { sport: "ufc", label: "UFC", icon: "🥊", href: "/ufc", accent: "#ef4444", carriesDate: false, resultsOnly: false, signalOnly: false },
  // signalOnly cleared 2026-07-21: ESPN's free tennis scoreboard now settles
  // matches (src/lib/tennis/results.ts), so tennis is tracked again.
  { sport: "tennis", label: "Tennis", icon: "🎾", href: "/tennis", accent: "#a3e635", carriesDate: false, resultsOnly: false, signalOnly: false },
  { sport: "soccer", label: "Soccer", icon: "⚽", href: "/soccer", accent: "#10b981", carriesDate: false, resultsOnly: false, signalOnly: false },
  { sport: "f1", label: "F1", icon: "🏁", href: "/f1", accent: "#e10600", carriesDate: false, resultsOnly: true, signalOnly: false },
] as const satisfies readonly SportMeta[];

/** Every registered sport's key — `"mlb" | "ufc" | "tennis" | "soccer" | "f1"`, derived. */
export type SportKey = (typeof SPORT_METAS)[number]["sport"];

/** Results-only sports (a page, no odds/Slate) — F1 today. Derived from `resultsOnly`. */
type ResultsOnlyMeta = Extract<(typeof SPORT_METAS)[number], { resultsOnly: true }>;

/** Sports on the odds Slate — every registered sport except the results-only ones. */
export type SlateSport = Exclude<SportKey, ResultsOnlyMeta["sport"]>;

/** Nav-level sport set — every registered sport (a superset of SlateSport). */
export type NavSport = SportKey;

/** Meta by registry key, for the adapters (and anyone needing a direct lookup). */
export const sportMetaByKey = Object.fromEntries(
  SPORT_METAS.map((m) => [m.sport, m])
) as Record<SportKey, SportMeta>;
