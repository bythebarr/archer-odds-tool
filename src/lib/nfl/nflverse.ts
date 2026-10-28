/**
 * The advanced NFL line from nflverse (github.com/nflverse/nflverse-data, free,
 * refreshed the morning after games), written onto our ESPN game logs:
 *
 *   - weekly player stats: air yards, YAC, first downs, EPA, CPOE, target share,
 *     air-yards share;
 *   - snap counts: offensive snaps and share;
 *   - the play-by-play, for what no box score has: red-zone and goal-line
 *     touches, end-zone and deep targets, dropbacks and scrambles; and each
 *     team's game — plays, dropbacks, neutral-situation pass rate vs expected,
 *     red-zone plays and EPA (NflTeamGame).
 *
 * Players join on nflverse's ESPN ids; games on the two teams and the date
 * (division rivals meet twice). Idempotent: every run rewrites the season.
 */
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { prisma } from "@/lib/prisma";

const BASE = "https://github.com/nflverse/nflverse-data/releases/download";
/** nflverse abbreviation → ours (ESPN's), where they differ. */
const TEAM_ALIAS: Record<string, string> = { LA: "LAR", WSH: "WAS", JAC: "JAX", LVR: "LV", OAK: "LV", SD: "LAC", STL: "LAR" };
const team = (abbr: string) => TEAM_ALIAS[abbr] ?? abbr;

/** One CSV line, quotes and embedded commas respected. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else if (c !== "\r") field += c;
  }
  out.push(field);
  return out;
}

/** Streams a CSV (gzipped or not) row by row as objects of the wanted columns. */
async function* rows(url: string, gz: boolean, want: string[]): AsyncGenerator<Record<string, string>> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`nflverse ${url}: ${res.status}`);
  let stream: NodeJS.ReadableStream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  if (gz) stream = stream.pipe(createGunzip());
  let idx: number[] | null = null;
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    if (!line) continue;
    const cells = splitCsvLine(line);
    if (!idx) {
      idx = want.map((w) => cells.indexOf(w));
      continue;
    }
    const o: Record<string, string> = {};
    want.forEach((w, i) => (o[w] = idx![i]! >= 0 ? (cells[idx![i]!] ?? "") : ""));
    yield o;
  }
}

const num = (s: string | undefined) => (s === undefined || s === "" || s === "NA" ? null : Number(s));
const int = (s: string | undefined) => {
  const n = num(s);
  return n === null || !Number.isFinite(n) ? null : Math.round(n);
};

interface PlayerGame {
  gsis: string;
  game: string;
  offenseSnaps: number | null;
  snapPct: number | null;
  targetShare: number | null;
  airYardsShare: number | null;
  airYards: number | null;
  yac: number | null;
  recFirstDowns: number | null;
  recEpa: number | null;
  rushFirstDowns: number | null;
  rushEpa: number | null;
  dropbacks: number;
  passAirYards: number | null;
  passEpa: number | null;
  cpoe: number | null;
  sacksTaken: number | null;
  scrambles: number;
  deepAttempts: number;
  rzTargets: number;
  rzCarries: number;
  glCarries: number;
  ezTargets: number;
  deepTargets: number;
  rzPassAttempts: number;
}

interface TeamGame {
  game: string;
  team: string;
  plays: number;
  dropbacks: number;
  passAttempts: number;
  rushAttempts: number;
  neutralPlays: number;
  neutralPasses: number;
  neutralXpass: number;
  rzPlays: number;
  epa: number;
  passEpa: number;
  rushEpa: number;
}

const blank = (gsis: string, game: string): PlayerGame => ({
  gsis,
  game,
  offenseSnaps: null,
  snapPct: null,
  targetShare: null,
  airYardsShare: null,
  airYards: null,
  yac: null,
  recFirstDowns: null,
  recEpa: null,
  rushFirstDowns: null,
  rushEpa: null,
  dropbacks: 0,
  passAirYards: null,
  passEpa: null,
  cpoe: null,
  sacksTaken: null,
  scrambles: 0,
  deepAttempts: 0,
  rzTargets: 0,
  rzCarries: 0,
  glCarries: 0,
  ezTargets: 0,
  deepTargets: 0,
  rzPassAttempts: 0,
});

export interface NflverseSummary {
  season: number;
  games: number;
  gamesMatched: number;
  playerRows: number;
  logsUpdated: number;
  teamRows: number;
}

/** Imports one season's advanced line onto the logs already stored. */
export async function importNflverseSeason(season: number): Promise<NflverseSummary> {
  // Players: nflverse id (gsis) and PFR id → ESPN athlete id.
  const espnOf = new Map<string, string>();
  const espnOfPfr = new Map<string, string>();
  for await (const r of rows(`${BASE}/players/players.csv`, false, ["gsis_id", "pfr_id", "espn_id"])) {
    if (!r.espn_id) continue;
    if (r.gsis_id) espnOf.set(r.gsis_id, r.espn_id);
    if (r.pfr_id) espnOfPfr.set(r.pfr_id, r.espn_id);
  }

  const players = new Map<string, PlayerGame>();
  const pg = (gsis: string, game: string) => {
    const k = `${game}|${gsis}`;
    let p = players.get(k);
    if (!p) players.set(k, (p = blank(gsis, game)));
    return p;
  };
  const teams = new Map<string, TeamGame>();
  const gameDate = new Map<string, string>();

  // Play-by-play.
  const PBP = ["game_id", "game_date", "posteam", "play_type", "yardline_100", "down", "air_yards", "receiver_player_id", "rusher_player_id", "passer_player_id", "pass_attempt", "rush_attempt", "qb_dropback", "qb_scramble", "epa", "wp", "half_seconds_remaining", "two_point_attempt", "qb_kneel", "qb_spike", "xpass"];
  for await (const r of rows(`${BASE}/pbp/play_by_play_${season}.csv.gz`, true, PBP)) {
    if (!r.game_id || !r.posteam || r.two_point_attempt === "1") continue;
    gameDate.set(r.game_id, r.game_date);
    const pass = r.pass_attempt === "1";
    const rush = r.rush_attempt === "1";
    const dropback = r.qb_dropback === "1";
    if (!(pass || rush || dropback) || r.qb_kneel === "1" || r.qb_spike === "1") continue;
    const yl = num(r.yardline_100);
    const air = num(r.air_yards);
    const epa = num(r.epa) ?? 0;
    const tk = `${r.game_id}|${team(r.posteam)}`;
    const t = teams.get(tk) ?? { game: r.game_id, team: team(r.posteam), plays: 0, dropbacks: 0, passAttempts: 0, rushAttempts: 0, neutralPlays: 0, neutralPasses: 0, neutralXpass: 0, rzPlays: 0, epa: 0, passEpa: 0, rushEpa: 0 };
    teams.set(tk, t);
    t.plays++;
    t.epa += epa;
    if (dropback) {
      t.dropbacks++;
      t.passEpa += epa;
    } else if (rush) t.rushEpa += epa;
    if (pass) t.passAttempts++;
    if (rush && !dropback) t.rushAttempts++;
    if (yl !== null && yl <= 20) t.rzPlays++;
    const wp = num(r.wp);
    const down = num(r.down);
    const half = num(r.half_seconds_remaining);
    if (wp !== null && wp >= 0.2 && wp <= 0.8 && (down === 1 || down === 2) && half !== null && half > 120) {
      t.neutralPlays++;
      if (dropback) t.neutralPasses++;
      t.neutralXpass += num(r.xpass) ?? 0;
    }
    if (dropback && r.passer_player_id) {
      const q = pg(r.passer_player_id, r.game_id);
      q.dropbacks++;
      if (r.qb_scramble === "1") q.scrambles++;
      if (pass && air !== null && air >= 20) q.deepAttempts++;
      if (pass && yl !== null && yl <= 20) q.rzPassAttempts++;
    }
    if (pass && r.receiver_player_id) {
      const w = pg(r.receiver_player_id, r.game_id);
      if (yl !== null && yl <= 20) w.rzTargets++;
      if (air !== null && yl !== null && air >= yl) w.ezTargets++;
      if (air !== null && air >= 20) w.deepTargets++;
    }
    if (rush && r.rusher_player_id) {
      const b = pg(r.rusher_player_id, r.game_id);
      if (yl !== null && yl <= 20) b.rzCarries++;
      if (yl !== null && yl <= 5) b.glCarries++;
    }
  }

  // Weekly advanced line.
  const W = ["player_id", "game_id", "passing_air_yards", "passing_epa", "passing_cpoe", "sacks_suffered", "rushing_first_downs", "rushing_epa", "receiving_air_yards", "receiving_yards_after_catch", "receiving_first_downs", "receiving_epa", "target_share", "air_yards_share", "attempts", "targets", "carries"];
  for await (const r of rows(`${BASE}/stats_player/stats_player_week_${season}.csv`, false, W)) {
    if (!r.player_id || !r.game_id) continue;
    const p = pg(r.player_id, r.game_id);
    if (int(r.attempts)) {
      p.passAirYards = int(r.passing_air_yards);
      p.passEpa = num(r.passing_epa);
      p.cpoe = num(r.passing_cpoe);
      p.sacksTaken = int(r.sacks_suffered);
    }
    if (int(r.carries)) {
      p.rushFirstDowns = int(r.rushing_first_downs);
      p.rushEpa = num(r.rushing_epa);
    }
    if (int(r.targets)) {
      p.airYards = int(r.receiving_air_yards);
      p.yac = int(r.receiving_yards_after_catch);
      p.recFirstDowns = int(r.receiving_first_downs);
      p.recEpa = num(r.receiving_epa);
      p.targetShare = num(r.target_share);
      p.airYardsShare = num(r.air_yards_share);
    }
  }

  // Snap counts (PFR ids).
  const snapByEspn = new Map<string, { snaps: number; pct: number }>();
  for await (const r of rows(`${BASE}/snap_counts/snap_counts_${season}.csv`, false, ["game_id", "pfr_player_id", "offense_snaps", "offense_pct"])) {
    const espn = espnOfPfr.get(r.pfr_player_id);
    const snaps = int(r.offense_snaps);
    if (espn && snaps) snapByEspn.set(`${r.game_id}|${espn}`, { snaps, pct: num(r.offense_pct) ?? 0 });
  }

  // Our games: nflverse "2026_07_LA_LV" (away_home) on its date → Game id.
  const games = await prisma.game.findMany({
    where: { sport: "nfl", season: { in: [season, season + 1] } },
    select: { id: true, scheduledStartUtc: true, homeTeam: { select: { id: true, abbreviation: true } }, awayTeam: { select: { id: true, abbreviation: true } } },
  });
  const gameOf = new Map<string, { id: string; home: string; away: string; homeId: string; awayId: string }>();
  for (const [g, date] of gameDate) {
    const [, , away, home] = g.split("_");
    if (!away || !home) continue;
    const day = new Date(`${date}T12:00:00Z`).getTime();
    const hit = games.find((x) => x.homeTeam?.abbreviation === team(home) && x.awayTeam?.abbreviation === team(away) && Math.abs(x.scheduledStartUtc.getTime() - day) < 2 * 86_400_000);
    if (hit?.homeTeam && hit.awayTeam) gameOf.set(g, { id: hit.id, home: team(home), away: team(away), homeId: hit.homeTeam.id, awayId: hit.awayTeam.id });
  }

  // Player rows → batched UPDATE … FROM unnest.
  const out: (PlayerGame & { espn: string; gameId: string })[] = [];
  for (const p of players.values()) {
    const espn = espnOf.get(p.gsis);
    const g = gameOf.get(p.game);
    if (!espn || !g) continue;
    const snap = snapByEspn.get(`${p.game}|${espn}`);
    out.push({ ...p, espn, gameId: g.id, offenseSnaps: snap?.snaps ?? null, snapPct: snap?.pct ?? null });
  }
  let logsUpdated = 0;
  for (let i = 0; i < out.length; i += 2000) {
    const c = out.slice(i, i + 2000);
    const col = <K extends keyof PlayerGame>(k: K) => c.map((r) => r[k]);
    logsUpdated += await prisma.$executeRaw`
      UPDATE "NflPlayerGameLog" l SET
        "offenseSnaps" = v.snaps, "snapPct" = v.pct, "targetShare" = v.ts, "airYardsShare" = v.ays, "airYards" = v.ay, "yac" = v.yac,
        "recFirstDowns" = v.rfd, "recEpa" = v.repa, "rushFirstDowns" = v.rufd, "rushEpa" = v.ruepa, "dropbacks" = v.db, "passAirYards" = v.pay,
        "passEpa" = v.pepa, "cpoe" = v.cpoe, "sacksTaken" = v.sk, "scrambles" = v.scr, "deepAttempts" = v.da, "rzTargets" = v.rzt,
        "rzCarries" = v.rzc, "glCarries" = v.glc, "ezTargets" = v.ezt, "deepTargets" = v.dt, "rzPassAttempts" = v.rzp
      FROM unnest(
        ${c.map((r) => r.espn)}::text[], ${c.map((r) => r.gameId)}::text[], ${col("offenseSnaps")}::int[], ${col("snapPct")}::float8[],
        ${col("targetShare")}::float8[], ${col("airYardsShare")}::float8[], ${col("airYards")}::int[], ${col("yac")}::int[],
        ${col("recFirstDowns")}::int[], ${col("recEpa")}::float8[], ${col("rushFirstDowns")}::int[], ${col("rushEpa")}::float8[],
        ${col("dropbacks")}::int[], ${col("passAirYards")}::int[], ${col("passEpa")}::float8[], ${col("cpoe")}::float8[],
        ${col("sacksTaken")}::int[], ${col("scrambles")}::int[], ${col("deepAttempts")}::int[], ${col("rzTargets")}::int[],
        ${col("rzCarries")}::int[], ${col("glCarries")}::int[], ${col("ezTargets")}::int[], ${col("deepTargets")}::int[], ${col("rzPassAttempts")}::int[]
      ) AS v(espn, game, snaps, pct, ts, ays, ay, yac, rfd, repa, rufd, ruepa, db, pay, pepa, cpoe, sk, scr, da, rzt, rzc, glc, ezt, dt, rzp)
      JOIN "NflPlayer" p ON p."espnAthleteId" = v.espn
      WHERE l."nflPlayerId" = p.id AND l."gameId" = v.game`;
  }

  // Team games.
  let teamRows = 0;
  for (const t of teams.values()) {
    const g = gameOf.get(t.game);
    if (!g) continue;
    const teamId = t.team === g.home ? g.homeId : t.team === g.away ? g.awayId : null;
    if (!teamId) continue;
    const data = { season, plays: t.plays, dropbacks: t.dropbacks, passAttempts: t.passAttempts, rushAttempts: t.rushAttempts, neutralPlays: t.neutralPlays, neutralPasses: t.neutralPasses, neutralXpass: t.neutralXpass, rzPlays: t.rzPlays, epa: t.epa, passEpa: t.passEpa, rushEpa: t.rushEpa };
    await prisma.nflTeamGame.upsert({ where: { gameId_teamId: { gameId: g.id, teamId } }, create: { gameId: g.id, teamId, ...data }, update: data });
    teamRows++;
  }
  return { season, games: gameDate.size, gamesMatched: gameOf.size, playerRows: out.length, logsUpdated, teamRows };
}
