/**
 * nflverse codes a relocated franchise's eras separately (see
 * docs/architecture/NFL-RESEARCH.md, "relocated-franchise history"). Rolling
 * play-level features and season-to-season priors need one continuous id per
 * franchise, so every pbp/games team code passes through here.
 */
const ALIASES: Record<string, string> = {
  OAK: "LV",
  SD: "LAC",
  STL: "LA",
  LAR: "LA", // defensive: nflverse never emits LAR, but this codebase's own display code does
};

export function franchise(code: string): string {
  return ALIASES[code] ?? code;
}
