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
