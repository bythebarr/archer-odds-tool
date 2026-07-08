/**
 * Logo files are optional and user-provided (not fetched/generated) — see
 * public/logos/{books,teams}/README.md for the expected filenames. The Logo
 * component tries each candidate in order and falls back to initials if none
 * of them exist yet, so nothing breaks before the files are added.
 */
export function bookLogoSources(_bookKey: string): string[] {
  // No book logo files ship today (public/logos/books is empty), and every book
  // has a distinct colored-initials badge (BOOK_INITIALS + BOOK_COLORS) that IS
  // its identity in this UI — so return nothing rather than probing paths that
  // only 404 and spam the console. Re-add the `/logos/books/${bookKey}.{svg,png}`
  // candidates here if real book logo files are ever added.
  return [];
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
