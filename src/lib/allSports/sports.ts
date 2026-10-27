/**
 * Every sport the all-sports engine carries, beyond the deep NBA / NFL / MLB /
 * UFC pipelines. Pure data, client-safe.
 *
 * `family` picks the model that prices it (allSports/model):
 *   goals  — low scores, draws possible: an attack/defense Poisson (soccer, hockey)
 *   points — high scores: opponent-adjusted points ratings, margin and total (basketball, rugby)
 *   winner — who wins, nothing else: Elo on results (tennis, darts, esports, combat)
 *   field  — many competitors, futures-style (golf, cycling): market only
 */
export type SportFamily = "goals" | "points" | "winner" | "field";

export interface AllSport {
  key: string;
  label: string;
  family: SportFamily;
  /** Glyph for the sport switcher (components/brand/Glyph). */
  glyph: string;
  /** Display order; the big betting sports first. */
  rank: number;
}

export const ALL_SPORTS: AllSport[] = [
  { key: "soccer", label: "Soccer", family: "goals", glyph: "soccer", rank: 10 },
  { key: "tennis", label: "Tennis", family: "winner", glyph: "tennis", rank: 20 },
  { key: "basketball", label: "Basketball", family: "points", glyph: "nba", rank: 30 },
  { key: "hockey", label: "Hockey", family: "goals", glyph: "hockey", rank: 40 },
  { key: "football", label: "Football", family: "points", glyph: "cfb", rank: 50 },
  { key: "baseball", label: "Baseball", family: "points", glyph: "mlb", rank: 60 },
  { key: "cricket", label: "Cricket", family: "winner", glyph: "cricket", rank: 70 },
  { key: "table-tennis", label: "Table Tennis", family: "winner", glyph: "table-tennis", rank: 80 },
  { key: "esports", label: "Esports", family: "winner", glyph: "esports", rank: 90 },
  { key: "darts", label: "Darts", family: "winner", glyph: "darts", rank: 100 },
  { key: "boxing", label: "Boxing", family: "winner", glyph: "boxing", rank: 110 },
  { key: "mma", label: "MMA", family: "winner", glyph: "ufc", rank: 115 },
  { key: "rugby-league", label: "Rugby League", family: "points", glyph: "rugby", rank: 120 },
  { key: "rugby-union", label: "Rugby Union", family: "points", glyph: "rugby", rank: 121 },
  { key: "rugby", label: "Rugby", family: "points", glyph: "rugby", rank: 122 },
  { key: "aussie-rules", label: "Aussie Rules", family: "points", glyph: "rugby", rank: 130 },
  { key: "volleyball", label: "Volleyball", family: "winner", glyph: "volleyball", rank: 140 },
  { key: "handball", label: "Handball", family: "points", glyph: "handball", rank: 150 },
  { key: "snooker", label: "Snooker", family: "winner", glyph: "snooker", rank: 160 },
  { key: "golf", label: "Golf", family: "field", glyph: "golf", rank: 170 },
  { key: "lacrosse", label: "Lacrosse", family: "points", glyph: "lacrosse", rank: 180 },
  { key: "futsal", label: "Futsal", family: "goals", glyph: "soccer", rank: 190 },
  { key: "badminton", label: "Badminton", family: "winner", glyph: "badminton", rank: 200 },
  { key: "padel", label: "Padel", family: "winner", glyph: "tennis", rank: 205 },
  { key: "squash", label: "Squash", family: "winner", glyph: "tennis", rank: 206 },
  { key: "beach-volleyball", label: "Beach Volleyball", family: "winner", glyph: "volleyball", rank: 210 },
  { key: "water-polo", label: "Water Polo", family: "goals", glyph: "volleyball", rank: 220 },
  { key: "floorball", label: "Floorball", family: "goals", glyph: "hockey", rank: 230 },
  { key: "bandy", label: "Bandy", family: "goals", glyph: "hockey", rank: 231 },
  { key: "beach-soccer", label: "Beach Soccer", family: "goals", glyph: "soccer", rank: 232 },
  { key: "curling", label: "Curling", family: "winner", glyph: "curling", rank: 240 },
  { key: "gaelic-football", label: "Gaelic Football", family: "points", glyph: "soccer", rank: 250 },
  { key: "beach-handball", label: "Beach Handball", family: "points", glyph: "handball", rank: 251 },
  { key: "cycling", label: "Cycling", family: "field", glyph: "cycling", rank: 260 },
  { key: "athletics", label: "Athletics", family: "field", glyph: "cycling", rank: 261 },
  { key: "cross-country", label: "Cross-Country", family: "field", glyph: "cycling", rank: 262 },
];

const BY_KEY = new Map(ALL_SPORTS.map((s) => [s.key, s]));

export function allSport(key: string): AllSport | null {
  return BY_KEY.get(key) ?? null;
}

/** A sport we don't list yet still gets a page: winner-only, titled from its key. */
export function allSportOrDefault(key: string): AllSport {
  return (
    BY_KEY.get(key) ?? {
      key,
      label: key.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      family: "winner",
      glyph: "props",
      rank: 900,
    }
  );
}

/** The Odds API's sport_key prefix → our sport. */
const TOA_PREFIX: Record<string, string> = {
  soccer: "soccer",
  tennis: "tennis",
  basketball: "basketball",
  americanfootball: "football",
  baseball: "baseball",
  icehockey: "hockey",
  cricket: "cricket",
  rugbyleague: "rugby-league",
  rugbyunion: "rugby-union",
  aussierules: "aussie-rules",
  boxing: "boxing",
  mma: "mma",
  golf: "golf",
  lacrosse: "lacrosse",
  handball: "handball",
};

/** odds-api.io's sport slug → our sport. */
const ODDS_API_IO_SPORT: Record<string, string> = {
  football: "soccer",
  "american-football": "football",
  "ice-hockey": "hockey",
  "mixed-martial-arts": "mma",
};

/**
 * Keys the deep pipelines own (NBA, NFL, MLB, UFC/MMA): the all-sports engine
 * skips them so a league is never polled twice.
 */
const TOA_DEDICATED = /^(basketball_nba(_preseason)?|americanfootball_nfl(_preseason)?|baseball_mlb(_preseason)?|mma_mixed_martial_arts)$/;
const TOA_SKIP = /^politics_/;

export interface ProviderLeagueRef {
  sport: string;
  slug: string;
}

/** A TOA sport_key → our sport and league slug, or null if another pipeline owns it. */
export function fromToaKey(key: string): ProviderLeagueRef | null {
  if (TOA_DEDICATED.test(key) || TOA_SKIP.test(key)) return null;
  const i = key.indexOf("_");
  if (i < 0) return null;
  const sport = TOA_PREFIX[key.slice(0, i)];
  if (!sport) return null;
  return { sport, slug: key.slice(i + 1).replace(/_/g, "-") };
}

/** An odds-api.io sport + league → ours, or null if another pipeline owns it. */
export function fromOddsApiIo(sportSlug: string, leagueSlug: string, leagueName: string): ProviderLeagueRef | null {
  const sport = ODDS_API_IO_SPORT[sportSlug] ?? sportSlug;
  const dedicated =
    (sport === "basketball" && /^usa\b.*\bnba\b/i.test(leagueName) && !/summer|g league|women/i.test(leagueName)) ||
    (sport === "football" && /^usa\b.*\bnfl\b/i.test(leagueName)) ||
    (sport === "baseball" && /^usa\b.*\bmlb\b/i.test(leagueName)) ||
    (sport === "mma" && /\bufc\b/i.test(leagueName));
  if (dedicated) return null;
  return { sport, slug: leagueSlug };
}
