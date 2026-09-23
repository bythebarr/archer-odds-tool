/**
 * One scrimmage play (pass or rush), reduced to the allow-listed columns the NFL
 * play-by-play research layer reads. See `docs/architecture/NFL-PBP-FEASIBILITY.md`.
 *
 * Deliberately absent: `result`, `total`, `spread_line`, `total_line`,
 * `vegas_wp`, `vegas_home_wp` — every pbp row carries the game's final score
 * and closing market, and the only way to guarantee no feature ever reads them
 * is to never load them. `loader.ts` builds this shape from an explicit
 * allow-list, never by copying a row wholesale.
 */
export interface NflPlay {
  gameId: string;
  season: number;
  week: number;
  /** "REG" | "POST" */
  seasonType: string;
  /** ISO date (YYYY-MM-DD), local game date as nflverse reports it. */
  gameDate: string;
  /** Franchise-normalized (OAK→LV, SD→LAC, STL→LA) — see `franchise.ts`. */
  posteam: string;
  defteam: string;
  homeTeam: string;
  pass: boolean;
  rush: boolean;
  qbDropback: boolean;
  qbScramble: boolean;
  down: number | null;
  ydstogo: number | null;
  yardline100: number | null;
  qtr: number;
  halfSecondsRemaining: number | null;
  /** In-game win probability for `posteam` (nflfastR's non-Vegas WP model). Used only to filter garbage time out of past plays. */
  wp: number | null;
  scoreDifferential: number | null;
  epa: number | null;
  success: boolean;
  yardsGained: number | null;
  sack: boolean;
  qbHit: boolean;
  interception: boolean;
  fumbleLost: boolean;
  touchdown: boolean;
  completePass: boolean;
  qbKneel: boolean;
  qbSpike: boolean;
  twoPointAttempt: boolean;
  /** nflfastR expected-pass probability (model output; null on many non-neutral downs). */
  xpass: number | null;
  airYards: number | null;
  passerId: string | null;
  passerName: string | null;
  rusherId: string | null;
  rusherName: string | null;
  receiverId: string | null;
  receiverName: string | null;
  passingYards: number | null;
  rushingYards: number | null;
  receivingYards: number | null;
}
