/**
 * Does an opportunity × efficiency projection beat per-game production for NFL
 * props? For every player-game with 4+ earlier games (no lookahead), compares
 * mean absolute error of:
 *   - base: projectNflProp (recency-weighted production, neutral context)
 *   - usage: his share of the team's targets/carries/attempts × the team's
 *     volume, × his efficiency shrunk toward the position's
 *   - blends of the two
 *
 *   npx tsx scripts/experiment-nfl-usage.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { NFL_PROP_STAT_BY_KEY } from "@/lib/nfl/propStats";
import { projectNflProp } from "@/lib/nfl/projection";
import type { NflLogPoint } from "@/lib/nfl/propsMath";

type G = NflLogPoint & { gameDate: Date; gameId: string; teamId: string; tgt: number; rush: number; att: number; snap: number | null };

const decayMean = (xs: number[], hl: number) => {
  if (!xs.length) return null;
  let s = 0;
  let w = 0;
  xs.forEach((x, i) => {
    const k = Math.pow(0.5, i / hl);
    s += k * x;
    w += k;
  });
  return s / w;
};

async function main() {
  const rows = await prisma.nflPlayerGameLog.findMany({ orderBy: [{ nflPlayerId: "asc" }, { gameDate: "asc" }] });
  const vol = await prisma.nflPlayerGameLog.groupBy({ by: ["gameId", "teamId"], _sum: { targets: true, rushAttempts: true, passAttempts: true } });
  const volOf = new Map(vol.map((v) => [`${v.gameId}|${v.teamId}`, v._sum]));
  // Each team's games, oldest first, for its expected volume.
  const teamGames = new Map<string, { date: Date; tgt: number; rush: number; att: number }[]>();
  const teamDates = new Map<string, Date>();
  for (const r of rows) teamDates.set(`${r.gameId}|${r.teamId}`, r.gameDate);
  for (const [k, d] of teamDates) {
    const [, team] = k.split("|");
    const s = volOf.get(k)!;
    teamGames.set(team!, [...(teamGames.get(team!) ?? []), { date: d, tgt: s.targets ?? 0, rush: s.rushAttempts ?? 0, att: s.passAttempts ?? 0 }]);
  }
  for (const l of teamGames.values()) l.sort((a, b) => a.date.getTime() - b.date.getTime());
  const teamVolumeBefore = (team: string, date: Date) => {
    const before = (teamGames.get(team) ?? []).filter((g) => g.date < date).reverse().slice(0, 17);
    return { tgt: decayMean(before.map((g) => g.tgt), 6), rush: decayMean(before.map((g) => g.rush), 6), att: decayMean(before.map((g) => g.att), 6) };
  };

  const byPlayer = new Map<string, G[]>();
  for (const r of rows) {
    const s = volOf.get(`${r.gameId}|${r.teamId}`)!;
    const g: G = { ...r, date: etDateOf(r.gameDate), opponent: "", gameId: r.gameId, teamId: r.teamId, tgt: s.targets ?? 0, rush: s.rushAttempts ?? 0, att: s.passAttempts ?? 0, snap: r.snapPct } as G;
    byPlayer.set(r.nflPlayerId, [...(byPlayer.get(r.nflPlayerId) ?? []), g]);
  }

  // League efficiency anchors.
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const YPT = sum((r) => r.recYards) / sum((r) => r.targets);
  const CATCH = sum((r) => r.receptions) / sum((r) => r.targets);
  const YPC = sum((r) => r.rushYards) / sum((r) => r.rushAttempts);
  const YPA = sum((r) => r.passYards) / Math.max(1, sum((r) => r.passAttempts));
  console.log(`league: ${YPT.toFixed(2)} yds/tgt, ${(CATCH * 100).toFixed(1)}% catch, ${YPC.toFixed(2)} ypc, ${YPA.toFixed(2)} ypa`);

  const STATS = ["recYards", "receptions", "rushYards", "passYards"] as const;
  for (const PRIOR of [15, 30, 60]) {
    const err: Record<string, { base: number; usage: number; b25: number; b50: number; b75: number; n: number }> = {};
    for (const games of byPlayer.values()) {
      for (let i = 4; i < games.length; i++) {
        const g = games[i]!;
        const hist = games.slice(0, i).reverse();
        const vol = teamVolumeBefore(g.teamId, g.gameDate);
        for (const key of STATS) {
          const stat = NFL_PROP_STAT_BY_KEY.get(key)!;
          const l5 = hist.slice(0, 5).reduce((a, x) => a + stat.value(x), 0) / Math.min(5, hist.length);
          if (l5 < (key === "receptions" ? 1 : 15)) continue;
          const base = projectNflProp(hist, stat, { defense: { season: 0, fromLastSeason: false, teams: {} }, opponent: null, position: null });
          if (!base) continue;
          const h = hist.slice(0, 17);
          let usage: number | null = null;
          if (key === "recYards" || key === "receptions") {
            const share = decayMean(h.map((x) => (x.tgt ? x.targets / x.tgt : 0)), 4);
            const tg = h.reduce((a, x) => a + x.targets, 0);
            const ypt = (h.reduce((a, x) => a + x.recYards, 0) + YPT * PRIOR) / (tg + PRIOR);
            const cr = (h.reduce((a, x) => a + x.receptions, 0) + CATCH * PRIOR) / (tg + PRIOR);
            if (share !== null && vol.tgt) usage = share * vol.tgt * (key === "recYards" ? ypt : cr);
          } else if (key === "rushYards") {
            const share = decayMean(h.map((x) => (x.rush ? x.rushAttempts / x.rush : 0)), 4);
            const c = h.reduce((a, x) => a + x.rushAttempts, 0);
            const ypc = (h.reduce((a, x) => a + x.rushYards, 0) + YPC * PRIOR * 2) / (c + PRIOR * 2);
            if (share !== null && vol.rush) usage = share * vol.rush * ypc;
          } else {
            const share = decayMean(h.map((x) => (x.att ? x.passAttempts / x.att : 0)), 4);
            const a = h.reduce((s, x) => s + x.passAttempts, 0);
            const ypa = (h.reduce((s, x) => s + x.passYards, 0) + YPA * PRIOR * 5) / (a + PRIOR * 5);
            if (share !== null && vol.att) usage = share * vol.att * ypa;
          }
          if (usage === null) continue;
          const actual = stat.value(g);
          const e = (err[key] ??= { base: 0, usage: 0, b25: 0, b50: 0, b75: 0, n: 0 });
          e.base += Math.abs(base.mean - actual);
          e.usage += Math.abs(usage - actual);
          e.b25 += Math.abs(0.75 * base.mean + 0.25 * usage - actual);
          e.b50 += Math.abs(0.5 * base.mean + 0.5 * usage - actual);
          e.b75 += Math.abs(0.25 * base.mean + 0.75 * usage - actual);
          e.n++;
        }
      }
    }
    for (const [k, e] of Object.entries(err)) {
      console.log(`prior=${PRIOR} ${k.padEnd(10)} n=${e.n}  base ${(e.base / e.n).toFixed(2)}  usage ${(e.usage / e.n).toFixed(2)}  25% ${(e.b25 / e.n).toFixed(2)}  50% ${(e.b50 / e.n).toFixed(2)}  75% ${(e.b75 / e.n).toFixed(2)}`);
    }
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
