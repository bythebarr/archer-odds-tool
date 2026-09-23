/**
 * One row per (regular-season game, offensive skill player who actually took an
 * offensive snap) — the unit NFL player-prop projections are built and graded
 * on. Research-only (offline scripts).
 *
 * Why three sources instead of one:
 *
 * - `stats_player/stats_player_week_<season>` is nflverse's official box score,
 *   the thing props settle on — but it only has a row for a player who
 *   recorded a stat, so a receiver who played 40 snaps and drew no target is
 *   simply absent. Grading only on present rows would silently drop real
 *   zeros and overstate every over.
 * - `snap_counts/snap_counts_<season>` (2012+) says who actually played
 *   (`offense_snaps > 0`), so those zeros can be filled in.
 * - `players/players.csv` crosswalks snap counts' PFR ids to the box score's
 *   GSIS ids (≈99.8% of skill-player snap rows map; the rest are dropped).
 *
 * "Played" is a prop-settlement convention, not a leak: books void a prop
 * when the player doesn't play, so outcomes are only defined for players who
 * did. Snap share itself is postgame and is only ever used lagged.
 */
import { franchise } from "../pbp/franchise";
import { loadReleaseCsv, num } from "../nflverse";

export type SkillPosition = "QB" | "RB" | "WR" | "TE";

export interface PlayerGame {
  gameId: string;
  season: number;
  week: number;
  team: string;
  opp: string;
  playerId: string; // GSIS id
  name: string;
  position: SkillPosition;
  offenseSnaps: number;
  offensePct: number;
  targets: number;
  receptions: number;
  receivingYards: number;
  carries: number;
  rushingYards: number;
  passAttempts: number;
  completions: number;
  passingYards: number;
}

/** Team offensive volume for one game, summed over every player in the box score (not just those with snap rows). */
export interface TeamGameVolume {
  gameId: string;
  season: number;
  week: number;
  team: string;
  opp: string;
  targets: number;
  carries: number;
  passAttempts: number;
}

const STAT_COLUMNS = [
  "player_id", "player_display_name", "position", "season", "week", "season_type", "game_id", "team", "opponent_team",
  "completions", "attempts", "passing_yards", "carries", "rushing_yards", "receptions", "targets", "receiving_yards",
] as const;
const SNAP_COLUMNS = ["game_id", "season", "week", "game_type", "pfr_player_id", "player", "position", "team", "opponent", "offense_snaps", "offense_pct"] as const;
const PLAYER_COLUMNS = ["gsis_id", "pfr_id", "display_name", "position"] as const;

function toSkill(pos: string): SkillPosition | null {
  if (pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE") return pos;
  if (pos === "FB" || pos === "HB") return "RB";
  return null;
}

export interface PlayerGameData {
  players: PlayerGame[];
  teams: TeamGameVolume[];
}

export async function loadPlayerGames(fromSeason: number, toSeason: number, log?: (msg: string) => void): Promise<PlayerGameData> {
  const crosswalk = await loadReleaseCsv("players", "players.csv", PLAYER_COLUMNS);
  if (!crosswalk) throw new Error("nflverse players.csv unavailable");
  const pfrToGsis = new Map<string, { gsis: string; name: string; position: string }>();
  for (const p of crosswalk) if (p.pfr_id && p.gsis_id) pfrToGsis.set(p.pfr_id, { gsis: p.gsis_id, name: p.display_name, position: p.position });

  const players: PlayerGame[] = [];
  const teams: TeamGameVolume[] = [];
  for (let season = fromSeason; season <= toSeason; season++) {
    const stats = await loadReleaseCsv("stats_player", `stats_player_week_${season}.csv.gz`, STAT_COLUMNS);
    const snaps = await loadReleaseCsv("snap_counts", `snap_counts_${season}.csv.gz`, SNAP_COLUMNS);
    if (!stats || !snaps) {
      log?.(`  ${season}: stats or snap counts not published — skipped`);
      continue;
    }

    const statByKey = new Map<string, (typeof stats)[number]>();
    const teamVol = new Map<string, TeamGameVolume>();
    for (const s of stats) {
      if (s.season_type !== "REG") continue;
      statByKey.set(`${s.game_id}|${s.player_id}`, s);
      const team = franchise(s.team);
      const key = `${s.game_id}|${team}`;
      let t = teamVol.get(key);
      if (!t) {
        t = { gameId: s.game_id, season, week: num(s.week) ?? 0, team, opp: franchise(s.opponent_team), targets: 0, carries: 0, passAttempts: 0 };
        teamVol.set(key, t);
      }
      t.targets += num(s.targets) ?? 0;
      t.carries += num(s.carries) ?? 0;
      t.passAttempts += num(s.attempts) ?? 0;
    }
    teams.push(...teamVol.values());

    let unmapped = 0;
    let zeroFilled = 0;
    for (const r of snaps) {
      if (r.game_type !== "REG") continue;
      const snapsOff = num(r.offense_snaps) ?? 0;
      if (snapsOff <= 0) continue;
      const position = toSkill(r.position);
      if (!position) continue;
      const id = pfrToGsis.get(r.pfr_player_id);
      if (!id) {
        unmapped++;
        continue;
      }
      const s = statByKey.get(`${r.game_id}|${id.gsis}`);
      if (!s) zeroFilled++;
      const v = (c: (typeof STAT_COLUMNS)[number]) => (s ? num(s[c]) ?? 0 : 0);
      players.push({
        gameId: r.game_id,
        season,
        week: num(r.week) ?? 0,
        team: franchise(r.team),
        opp: franchise(r.opponent),
        playerId: id.gsis,
        name: s?.player_display_name || id.name || r.player,
        position,
        offenseSnaps: snapsOff,
        offensePct: num(r.offense_pct) ?? 0,
        targets: v("targets"),
        receptions: v("receptions"),
        receivingYards: v("receiving_yards"),
        carries: v("carries"),
        rushingYards: v("rushing_yards"),
        passAttempts: v("attempts"),
        completions: v("completions"),
        passingYards: v("passing_yards"),
      });
    }
    log?.(`  ${season}: ${players.length} cumulative skill player-games (${zeroFilled} zero-stat games filled, ${unmapped} unmapped dropped)`);
  }
  return { players, teams };
}
