import { SPORT_METAS } from "@/lib/engine/sportsMeta";
import type { SportMeta, SlateSport, NavSport } from "@/lib/engine/sportsMeta";

/**
 * Sport display + routing, DERIVED from the client-safe sport-meta list
 * (`SPORT_METAS`) — the ONE place a sport's identity/display lives, which the
 * heavy `SportAdapter`s reference too. So the Home launcher, the SportRail, the
 * /sports lobby, and the nav can't drift out of sync with the registry
 * (sport-engine Phase 3d). Importing the leaf (not @/lib/engine) keeps this
 * safe for the client nav bars — no prisma/ingest code follows it into the bundle.
 *
 * SlateSport vs NavSport: NavSport is every registered sport; SlateSport drops
 * the results-only ones (F1 has a page but no odds/Slate). Both derive from
 * `resultsOnly` — see @/lib/engine/sportsMeta.
 */
export type { SportMeta, NavSport };

/** Every sport with a page, keyed by registry key — slate sports plus results-only ones. */
export const NAV_SPORT_META = Object.fromEntries(
  SPORT_METAS.map((m) => [m.sport, m])
) as Record<NavSport, SportMeta>;

/** Nav/launcher display order — every registered sport, in registry order. */
export const NAV_SPORT_ORDER = SPORT_METAS.map((m) => m.sport) as NavSport[];

/** Odds-Slate sports only (excludes results-only F1), in registry order. */
export const SPORT_ORDER = SPORT_METAS.filter((m) => !m.resultsOnly).map(
  (m) => m.sport
) as SlateSport[];

/** Slate-sport display meta, keyed by SlateSport (indexed by the Slate's rows). */
export const SPORT_META = Object.fromEntries(
  SPORT_METAS.filter((m) => !m.resultsOnly).map((m) => [m.sport, m])
) as Record<SlateSport, SportMeta>;

/** A sport's route, carrying the browsed date when the sport is date-scoped. */
export function sportHref(sport: NavSport, date: string): string {
  const meta = NAV_SPORT_META[sport];
  return meta.carriesDate ? `${meta.href}?date=${date}` : meta.href;
}
