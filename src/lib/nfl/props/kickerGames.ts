/**
 * Kicker box scores (nflverse weekly player stats, position K) for kicker
 * props: field goals made and kicking points (3 × FG made + extra points
 * made). A kicker "played" when he has a box-score row. Kickers log no
 * offensive snaps, so snap counts can't fill zeros the way they do for skill
 * players. A kicker with no kicks at all in a game (rare) has no row and is
 * missing, which slightly understates zero-FG games. Research-only.
 */
import { loadReleaseCsv, num } from "../nflverse";
import { franchise } from "../pbp/franchise";

export interface KickerGame {
  gameId: string;
  season: number;
  week: number;
  team: string;
  opp: string;
  playerId: string;
  name: string;
  fgMade: number;
  fgAtt: number;
  patMade: number;
  patAtt: number;
}

export const kickingPoints = (k: Pick<KickerGame, "fgMade" | "patMade">) => 3 * k.fgMade + k.patMade;

const COLUMNS = ["player_id", "player_display_name", "position", "season", "week", "season_type", "game_id", "team", "opponent_team", "fg_made", "fg_att", "pat_made", "pat_att"] as const;

export async function loadKickerGames(fromSeason: number, toSeason: number): Promise<KickerGame[]> {
  const out: KickerGame[] = [];
  for (let season = fromSeason; season <= toSeason; season++) {
    const rows = await loadReleaseCsv("stats_player", `stats_player_week_${season}.csv.gz`, COLUMNS);
    for (const r of rows ?? []) {
      if (r.season_type !== "REG" || r.position !== "K") continue;
      out.push({
        gameId: r.game_id,
        season,
        week: num(r.week) ?? 0,
        team: franchise(r.team),
        opp: franchise(r.opponent_team),
        playerId: r.player_id,
        name: r.player_display_name,
        fgMade: num(r.fg_made) ?? 0,
        fgAtt: num(r.fg_att) ?? 0,
        patMade: num(r.pat_made) ?? 0,
        patAtt: num(r.pat_att) ?? 0,
      });
    }
  }
  return out;
}
