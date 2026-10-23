/**
 * Logo files are optional and user-provided (not fetched/generated) — see
 * public/logos/{books,teams}/README.md for the expected filenames. The Logo
 * component tries each candidate in order and falls back to initials if none
 * of them exist yet, so nothing breaks before the files are added.
 */
/**
 * Each book's own site, for its app icon. The icon is pulled through Google's
 * favicon service at 128px — the same mark the book shows in a browser tab and
 * on a phone's home screen — and the Logo component falls back to the colored
 * initials badge if it ever fails to load.
 */
const BOOK_DOMAINS: Record<string, string> = {
  draftkings: "sportsbook.draftkings.com",
  fanduel: "sportsbook.fanduel.com",
  betmgm: "sports.betmgm.com",
  betrivers: "betrivers.com",
  espnbet: "espnbet.com",
  caesars: "sportsbook.caesars.com",
  fanatics: "sportsbook.fanatics.com",
  bet365: "bet365.com",
  hardrock: "hardrock.bet",
  parx: "betparx.com",
  pinnacle: "pinnacle.com",
};

/**
 * Book keys with a hand-placed file in public/logos/books (see its README) — a
 * file there beats the favicon. Listed explicitly so no request probes a path
 * that 404s.
 */
const LOCAL_BOOK_LOGOS = new Set<string>();

export function bookLogoSources(bookKey: string): string[] {
  const sources: string[] = [];
  if (LOCAL_BOOK_LOGOS.has(bookKey)) sources.push(`/logos/books/${bookKey}.svg`);
  const domain = BOOK_DOMAINS[bookKey];
  if (domain) sources.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
  return sources;
}

export function teamLogoSources(abbreviation: string): string[] {
  return [`/logos/teams/${abbreviation}.svg`, `/logos/teams/${abbreviation}.png`];
}

/** Tennis players have no stable abbreviation like a team does, so this slugs the full name instead (e.g. "Alex de Minaur" -> "alex-de-minaur"). */
export function playerLogoSources(name: string): string[] {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return [`/logos/players/${slug}.svg`, `/logos/players/${slug}.png`];
}

/**
 * MLB's own official photo CDN (img.mlbstatic.com) — the same one MLB.com
 * itself serves headshots from, keyed by mlbPersonId. Hotlinked directly
 * rather than downloaded/rehosted: unlike team crests or sportsbook brand
 * marks (which would need a real licensing decision, deliberately not made
 * here — see the local /logos/{teams,books} fallback-only setup), this is
 * a public data CDN we're already pulling player data from for legitimate
 * stats purposes, the same hotlinking pattern virtually every third-party
 * baseball site uses for player photos.
 */
export function mlbHeadshotUrl(mlbPersonId: number): string {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_180,q_100/v1/people/${mlbPersonId}/headshot/67/current`;
}

/**
 * MLB's public team-logo CDN, keyed by the same mlbTeamId we already store on
 * Team — the counterpart to mlbHeadshotUrl for clubs. Same hotlinking rationale
 * (a public data CDN MLB.com itself serves from); falls back to the local
 * /logos/teams file, then the colored initials badge, via the Logo source chain.
 */
export function mlbTeamLogoUrl(mlbTeamId: number): string {
  return `https://www.mlbstatic.com/team-logos/${mlbTeamId}.svg`;
}

/**
 * ESPN's public logo CDN for NBA and NFL clubs — the counterpart to
 * mlbTeamLogoUrl, from the provider whose scoreboards already settle these
 * leagues. ESPN keys logos by its own short codes, which differ from ours for a
 * handful of teams (NYK→ny, GSW→gs, WAS→wsh, …); everything else is our
 * abbreviation lowercased.
 */
const ESPN_LOGO_CODE: Record<"nba" | "nfl", Record<string, string>> = {
  nba: { NYK: "ny", GSW: "gs", WAS: "wsh", UTA: "utah", NOP: "no", SAS: "sa" },
  nfl: { WAS: "wsh" },
};

/** ESPN's short code for a club — its logo key and its slug in ESPN's site API. */
export function espnTeamCode(league: "nba" | "nfl", abbreviation: string): string {
  return ESPN_LOGO_CODE[league][abbreviation] ?? abbreviation.toLowerCase();
}

export function espnTeamLogoUrl(league: "nba" | "nfl", abbreviation: string): string {
  return `https://a.espncdn.com/i/teamlogos/${league}/500/${espnTeamCode(league, abbreviation)}.png`;
}

/** ESPN's college logo, keyed by ESPN's numeric team id (college programs have no stable short code). */
export function espnNcaaLogoUrl(espnTeamId: string | number): string {
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${espnTeamId}.png`;
}

/**
 * ESPN's public NBA headshot, keyed by the athlete id our game logs already
 * store — the counterpart to mlbHeadshotUrl. Built from the id rather than
 * trusting a stored URL, so every player with a log has a photo.
 */
export function nbaHeadshotUrl(espnAthleteId: string): string {
  return `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${espnAthleteId}.png&w=192&h=140&scale=crop`;
}
