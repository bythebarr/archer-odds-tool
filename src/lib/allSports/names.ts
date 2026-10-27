/**
 * Team names differ by source: the odds feed says "Bournemouth", ESPN "AFC
 * Bournemouth", another "Bayern München" for "Bayern Munich". Ratings and logos
 * join on a normalized name, and a token match bridges the rest.
 */
const FILLER = new Set([
  "fc", "afc", "cf", "sc", "ac", "cd", "ud", "rc", "rcd", "sd", "ss", "ssc", "as", "us", "fk", "sk", "if", "bk", "ik",
  "club", "de", "del", "the", "calcio", "sv", "vfb", "vfl", "tsg", "1", "cfc", "ca", "ec", "se", "sl", "fbc", "hc", "bc",
  "kv", "krc", "rsc",
]);

/** Accents off, lowercase, punctuation to spaces. */
export function canonicalName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The tokens that identify a team: canonical name minus filler like "FC". Keeps filler if that's all there is. */
export function nameTokens(name: string): string[] {
  const all = canonicalName(name).split(" ").filter(Boolean);
  const core = all.filter((t) => !FILLER.has(t));
  return core.length > 0 ? core : all;
}

/** The join key: core tokens in order. */
export function teamKey(name: string): string {
  return nameTokens(name).join(" ");
}

const ALIASES: Record<string, string> = {
  "bayern munchen": "bayern munich",
  "inter milan": "internazionale",
  inter: "internazionale",
  "psg": "paris saint germain",
  "wolves": "wolverhampton wanderers",
  "spurs": "tottenham hotspur",
  "man utd": "manchester united",
  "nottm forest": "nottingham forest",
};

/** Similarity of two names in [0, 1]: 1 for the same key, high when one's tokens contain the other's. */
export function nameSimilarity(a: string, b: string): number {
  const ka = ALIASES[teamKey(a)] ?? teamKey(a);
  const kb = ALIASES[teamKey(b)] ?? teamKey(b);
  if (ka === kb) return 1;
  const ta = new Set(ka.split(" "));
  const tb = new Set(kb.split(" "));
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  if (shared === 0) return 0;
  const minSize = Math.min(ta.size, tb.size);
  // "Tottenham" ⊂ "Tottenham Hotspur": a full subset counts nearly as a match.
  if (shared === minSize) return 0.9 - 0.05 * Math.abs(ta.size - tb.size);
  return shared / Math.max(ta.size, tb.size);
}

/** The best match for `name` among `candidates`, if it's clearly the same team. */
export function bestMatch(name: string, candidates: Iterable<string>, min = 0.75): string | null {
  let best: string | null = null;
  let bestScore = 0;
  let tie = false;
  for (const c of candidates) {
    const s = nameSimilarity(name, c);
    if (s > bestScore) {
      best = c;
      bestScore = s;
      tie = false;
    } else if (s === bestScore && s > 0) tie = true;
  }
  return bestScore >= min && !(tie && bestScore < 1) ? best : null;
}
