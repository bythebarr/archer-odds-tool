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

const ACTIVE_METAS = SPORT_METAS.filter((m) => !m.parked);

/** Nav/launcher display order — the lineup (every sport not parked), in registry order. */
export const NAV_SPORT_ORDER = ACTIVE_METAS.map((m) => m.sport) as NavSport[];

/** Parked sports, for the /sports hub's "Offseason" shelf. See SportMeta.parked. */
export const PARKED_SPORT_ORDER = SPORT_METAS.filter((m) => m.parked).map((m) => m.sport) as NavSport[];

/** Odds-Slate sports in the lineup (excludes parked and results-only), in registry order. */
export const SPORT_ORDER = ACTIVE_METAS.filter((m) => !m.resultsOnly).map(
  (m) => m.sport
) as SlateSport[];

/** True when a sport is out of the lineup — its Slate queries and Discord plays are skipped. */
export function isParked(sport: string): boolean {
  return SPORT_METAS.some((m) => m.sport === sport && m.parked);
}

/** Slate-sport display meta, keyed by SlateSport (indexed by the Slate's rows). */
export const SPORT_META = Object.fromEntries(
  SPORT_METAS.filter((m) => !m.resultsOnly).map((m) => [m.sport, m])
) as Record<SlateSport, SportMeta>;

/** A sport's route, carrying the browsed date when the sport is date-scoped. */
export function sportHref(sport: NavSport, date: string): string {
  const meta = NAV_SPORT_META[sport];
  return meta.carriesDate ? `${meta.href}?date=${date}` : meta.href;
}
