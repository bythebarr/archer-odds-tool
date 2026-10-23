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
// each entry's shape. Order is display order — nav, the Home launcher, and the
// SportRail all render in it. `resultsOnly`, `signalOnly` and `parked` are set
// explicitly on every entry so all three are readable on the literal union.
export const SPORT_METAS = [
  // The lineup — what the nav, Home, the Slate and the Discord card show.
  // NBA, NFL: odds line-shopping, graded off ESPN's free scoreboard (teamLeague/results.ts).
  { sport: "nba", label: "NBA", icon: "🏀", href: "/nba", accent: "#c026d3", carriesDate: false, resultsOnly: false, signalOnly: false, parked: false },
  { sport: "nfl", label: "NFL", icon: "🏈", href: "/nfl", accent: "#f59e0b", carriesDate: false, resultsOnly: false, signalOnly: false, parked: false },
  { sport: "ufc", label: "UFC", icon: "🥊", href: "/ufc", accent: "#ef4444", carriesDate: false, resultsOnly: false, signalOnly: false, parked: false },
  // Parked (2026-10-23): MLB for the offseason; tennis, soccer and F1 until there's
  // time to bring them up to the same standard. Pages and history stay.
  { sport: "mlb", label: "MLB", icon: "⚾", href: "/mlb", accent: "#3b82f6", carriesDate: true, resultsOnly: false, signalOnly: false, parked: true },
  { sport: "tennis", label: "Tennis", icon: "🎾", href: "/tennis", accent: "#a3e635", carriesDate: false, resultsOnly: false, signalOnly: false, parked: true },
  { sport: "soccer", label: "Soccer", icon: "⚽", href: "/soccer", accent: "#10b981", carriesDate: false, resultsOnly: false, signalOnly: false, parked: true },
  { sport: "f1", label: "F1", icon: "🏁", href: "/f1", accent: "#e10600", carriesDate: false, resultsOnly: true, signalOnly: false, parked: true },
] as const satisfies readonly SportMeta[];

/** Every registered sport's key — `"mlb" | "nfl" | "nba" | "ufc" | …`, derived. */
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
