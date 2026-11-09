/**
 * The sport card `backtest-games` publishes for each game-model sport.
 *
 * The trust gate reads verdicts by bare sport key (queries/modelTrust), so a
 * game model's walk-forward moneyline grade must be saved under the sport's
 * own key — not only under `<sport>-games:ml`, which nothing gates on.
 * Decision 8 (Phase 4) wired this for the NFL after finding its grade
 * invisible to the gate; Phase 5 makes the publication uniform so the two
 * game-model sports can't drift apart again — every sport the backtest runs
 * publishes its card, by construction rather than by a per-sport `if`.
 */

/** The game-model sports `backtest-games` runs (mirrors its `Sport` type). */
export type GameModelSport = "nba" | "nfl";

export interface SportCardSpec {
  /** ModelReport key the trust gate and /models read for this sport. */
  key: string;
  /** Card title as shown on /models. */
  label: string;
  /** The model that prices this sport's games (extra.pricingModel). */
  pricingModel: string;
}

/**
 * The sport card for one game-model sport. Both sports are priced by the
 * points-ratings game model (queries/gameModel), so the spec is uniform —
 * the per-sport difference is only the key and label's sport name.
 */
export function sportCardFor(sport: GameModelSport): SportCardSpec {
  return {
    key: sport,
    label: `${sport.toUpperCase()} games — moneyline (points ratings, pricing)`,
    pricingModel: "points-ratings",
  };
}
