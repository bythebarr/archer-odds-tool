/**
 * Logo files are optional and user-provided (not fetched/generated) — see
 * public/logos/{books,teams}/README.md for the expected filenames. The Logo
 * component tries each candidate in order and falls back to initials if none
 * of them exist yet, so nothing breaks before the files are added.
 */
export function bookLogoSources(bookKey: string): string[] {
  return [`/logos/books/${bookKey}.svg`, `/logos/books/${bookKey}.png`];
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
