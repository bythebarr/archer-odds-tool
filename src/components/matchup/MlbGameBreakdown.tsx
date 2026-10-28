/**
 * The MLB matchup breakdown on the shared matchup pieces (the same face-off,
 * ARCHR vs the book, tale of the tape and "why" as NBA, NFL, UFC and every
 * other sport). Away is side A (left), home side B.
 *
 * ARCHR's numbers: the win chance from the Archer model (starters + form,
 * archer/winProbability.ts); runs from archer/expectedRuns.ts, spread into a
 * distribution per team (negative binomial, variance ≈ 2.1× the mean — MLB's
 * run scoring) for the run line and the total. Each market is blended with the
 * books' no-vig consensus at its main number, the way every sport is.
 */
import Link from "next/link";
import type { GameSummary, GameLineRow } from "@/lib/queries/games";
import type { GameMatchup, PitcherInfo } from "@/lib/queries/matchup";
import type { ArcherWinProbability } from "@/lib/archer/winProbability";
import type { ExpectedRuns } from "@/lib/archer/expectedRuns";
import type { RecordSplit, RunsSplit } from "@/lib/queries/teamForm";
import { startSplitEraPerNine } from "@/lib/archer/pitcherRecency";
import { marketConsensus } from "@/lib/odds/lineEconomics";
import { calculateEv } from "@/lib/odds/devig";
import { isBettableBook } from "@/lib/odds/bestPrice";
import { blendWithMarket, DEFAULT_MODEL_WEIGHT } from "@/lib/propModel/market";
import { decimalToAmerican, formatAmerican } from "@/lib/odds/americanOdds";
import { TeamBadge } from "@/components/TeamBadge";
import { FaceOff, SIDE_A_COLOR, SIDE_B_COLOR, TaleOfTape, ValueStrip, WhyPanel, type Factor, type TapeRowData, type ValueRow } from "./Matchup";

const RUN_VARIANCE_RATIO = 2.1;
const fair = (p: number) => formatAmerican(Math.round(decimalToAmerican(1 / Math.min(0.995, Math.max(0.005, p)))));
const nick = (name: string) => name.split(" ").at(-1)!;
const signedLine = (x: number) => (x === 0 ? "PK" : x > 0 ? `+${x}` : `−${Math.abs(x)}`);
const era = (x: number | null | undefined) => (x === null || x === undefined ? "—" : x.toFixed(2));
const rec = (r: RecordSplit) => (r.gamesFound ? `${r.wins}-${r.losses}` : "—");
const perGame = (r: RunsSplit, side: "for" | "against") => (r.gamesFound ? (side === "for" ? r.runsFor : r.runsAgainst) / r.gamesFound : null);

/** Runs for one team: negative binomial with MLB's spread. */
function runsPmf(mean: number, max = 30): number[] {
  const variance = mean * RUN_VARIANCE_RATIO;
  const r = (mean * mean) / (variance - mean);
  const p = r / (r + mean);
  const out = new Array(max + 1).fill(0);
  let t = Math.pow(p, r);
  for (let k = 0; k <= max; k++) {
    out[k] = t;
    t *= ((k + r) / (k + 1)) * (1 - p);
  }
  return out;
}

/**
 * P(home wins by more than x) and P(total > x) from the two teams' run
 * distributions. A tie after nine goes to extras, which nearly always end by a
 * run: its chance is split between +1 and −1 (and the total gains a run).
 */
export function runsModel(homeMean: number, awayMean: number) {
  const h = runsPmf(homeMean);
  const a = runsPmf(awayMean);
  const margin = new Map<number, number>();
  const total = new Map<number, number>();
  const add = (m: Map<number, number>, k: number, p: number) => m.set(k, (m.get(k) ?? 0) + p);
  h.forEach((ph, i) =>
    a.forEach((pa, j) => {
      const p = ph * pa;
      if (i === j) {
        add(margin, 1, p / 2);
        add(margin, -1, p / 2);
        add(total, i + j + 1, p);
      } else {
        add(margin, i - j, p);
        add(total, i + j, p);
      }
    })
  );
  const above = (m: Map<number, number>, x: number) => [...m].reduce((s, [k, p]) => (k > x ? s + p : s), 0);
  return { homeBy: (x: number) => above(margin, x), over: (x: number) => above(total, x) };
}

function best(lines: GameLineRow[], market: GameLineRow["marketType"], side: string, point: number | null) {
  return lines
    .filter((l) => l.marketType === market && l.side === side && !l.isAlternate && isBettableBook(l.bookKey) && (point === null || l.point === point))
    .reduce<GameLineRow | null>((b, l) => (!b || l.priceAmerican > b.priceAmerican ? l : b), null);
}

function pitcherLine(p: PitcherInfo | null): string {
  if (!p) return "Starter TBD";
  return `${p.fullName.split(" ").at(-1)}${p.pitchHand ? ` (${p.pitchHand})` : ""} · ${era(p.era)} ERA`;
}

export function MlbFaceOff({ game, matchup, prob, runs, when }: { game: GameSummary; matchup: GameMatchup | null; prob: ArcherWinProbability | null; runs: ExpectedRuns | null; when: string }) {
  const badge = (t: GameSummary["homeTeam"]) => <TeamBadge abbreviation={t.abbreviation} name={t.name} mlbTeamId={t.mlbTeamId} size={72} />;
  const final = game.homeScore !== null && game.awayScore !== null && game.status === "final";
  return (
    <FaceOff
      a={{ name: game.awayTeam.name, sub: pitcherLine(matchup?.awayPitcher ?? null), badge: badge(game.awayTeam), color: SIDE_A_COLOR }}
      b={{ name: game.homeTeam.name, sub: pitcherLine(matchup?.homePitcher ?? null), badge: badge(game.homeTeam), color: SIDE_B_COLOR }}
      probA={prob?.awayProb ?? null}
      center="@"
      meta={when}
      probLabel={prob && !prob.usedPitcher.home && !prob.usedPitcher.away ? "ARCHR win probability · form only, starters TBD" : "ARCHR win probability"}
      chips={
        runs?.home != null && runs.away != null ? (
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[#eef0f4]">
            ARCHR runs {game.awayTeam.abbreviation} {runs.away.toFixed(1)} – {runs.home.toFixed(1)} {game.homeTeam.abbreviation} · O/U {(Math.round((runs.home + runs.away) * 2) / 2).toFixed(1)}
          </span>
        ) : null
      }
      footer={
        final ? (
          <span>
            Final · {game.awayTeam.abbreviation} <span className="font-semibold">{game.awayScore}</span> – <span className="font-semibold">{game.homeScore}</span> {game.homeTeam.abbreviation}
          </span>
        ) : null
      }
    />
  );
}

export function MlbBreakdown({ game, lines, matchup, prob, runs }: { game: GameSummary; lines: GameLineRow[]; matchup: GameMatchup; prob: ArcherWinProbability | null; runs: ExpectedRuns | null }) {
  const away = game.awayTeam;
  const home = game.homeTeam;
  const a = { label: away.abbreviation, color: SIDE_A_COLOR };
  const b = { label: home.abbreviation, color: SIDE_B_COLOR };
  const rows: ValueRow[] = [];
  const blend = (model: number, market: number | null) => (market === null ? model : blendWithMarket(model, market, DEFAULT_MODEL_WEIGHT));

  // Moneyline.
  if (prob?.homeProb != null) {
    const mkt = marketConsensus(lines, "h2h");
    const pHome = blend(prob.homeProb, mkt.fairProbA);
    const bh = best(lines, "h2h", "home", null);
    const ba = best(lines, "h2h", "away", null);
    const evH = bh ? calculateEv(pHome, bh.priceAmerican) : null;
    const evA = ba ? calculateEv(1 - pHome, ba.priceAmerican) : null;
    const pickHome = evH !== null || evA !== null ? (evH ?? -Infinity) >= (evA ?? -Infinity) : pHome >= 0.5;
    const pick = pickHome ? { team: home, p: pHome, line: bh, ev: evH } : { team: away, p: 1 - pHome, line: ba, ev: evA };
    rows.push({ market: "Moneyline", pick: nick(pick.team.name), fair: fair(pick.p), best: pick.line ? { priceAmerican: pick.line.priceAmerican, bookKey: pick.line.bookKey, bookName: pick.line.bookName } : null, edge: pick.ev });
  }

  // Run line and total, from the runs model.
  if (runs?.home != null && runs.away != null) {
    const m = runsModel(runs.home, runs.away);
    const spreadMkt = marketConsensus(lines, "spreads");
    const homePoint = spreadMkt.modalPoint ?? (runs.home >= runs.away ? -1.5 : 1.5);
    const pHomeCover = blend(m.homeBy(-homePoint), spreadMkt.fairProbA);
    const sh = best(lines, "spreads", "home", homePoint);
    const sa = best(lines, "spreads", "away", -homePoint);
    const evH = sh ? calculateEv(pHomeCover, sh.priceAmerican) : null;
    const evA = sa ? calculateEv(1 - pHomeCover, sa.priceAmerican) : null;
    const pickHome = (evH ?? -Infinity) > (evA ?? -Infinity) || (evH === null && evA === null && pHomeCover >= 0.5);
    rows.push({
      market: "Run line",
      pick: pickHome ? `${nick(home.name)} ${signedLine(homePoint)}` : `${nick(away.name)} ${signedLine(-homePoint)}`,
      fair: fair(pickHome ? pHomeCover : 1 - pHomeCover),
      best: (pickHome ? sh : sa) ? { priceAmerican: (pickHome ? sh : sa)!.priceAmerican, bookKey: (pickHome ? sh : sa)!.bookKey, bookName: (pickHome ? sh : sa)!.bookName } : null,
      edge: pickHome ? evH : evA,
    });

    const totMkt = marketConsensus(lines, "totals");
    const total = runs.home + runs.away;
    const point = totMkt.modalPoint ?? Math.round(total - 0.5) + 0.5;
    const pOver = blend(m.over(point), totMkt.fairProbA);
    const bo = best(lines, "totals", "over", point);
    const bu = best(lines, "totals", "under", point);
    const evO = bo ? calculateEv(pOver, bo.priceAmerican) : null;
    const evU = bu ? calculateEv(1 - pOver, bu.priceAmerican) : null;
    const over = (evO ?? -Infinity) > (evU ?? -Infinity) || (evO === null && evU === null && pOver >= 0.5);
    const t = over ? bo : bu;
    rows.push({
      market: "Total",
      pick: `${over ? "Over" : "Under"} ${point}`,
      fair: fair(over ? pOver : 1 - pOver),
      best: t ? { priceAmerican: t.priceAmerican, bookKey: t.bookKey, bookName: t.bookName } : null,
      bookLine: `ARCHR ${total.toFixed(1)}`,
      edge: over ? evO : evU,
    });
  }

  const better = (x: number | null, y: number | null, minGap: number, higher = true): "a" | "b" | null => {
    if (x === null || y === null || Math.abs(x - y) < minGap) return null;
    return (higher ? x > y : x < y) ? "a" : "b";
  };
  const af = matchup.awayForm;
  const hf = matchup.homeForm;
  const ap = matchup.awayPitcher;
  const hp = matchup.homePitcher;
  const pen = (s: GameMatchup["homeBullpen"]) => (s && s.outsRecorded > 0 ? (27 * s.earnedRuns) / s.outsRecorded : null);
  const workload = (w: GameMatchup["homeBullpenRecentWorkload"]) => (w ? `${Math.round(w.outsRecorded / 3)} IP / ${w.games}d` : "—");
  const f1 = (x: number | null) => (x === null ? "—" : x.toFixed(1));
  const tape: TapeRowData[] = [
    { label: "Last 10", a: rec(af.last10), b: rec(hf.last10), edge: better(af.last10.wins, hf.last10.wins, 1) },
    { label: "Last 5", a: rec(af.last5), b: rec(hf.last5), edge: better(af.last5.wins, hf.last5.wins, 1) },
    { label: "Road / home", a: rec(af.awayRecord), b: rec(hf.homeRecord) },
    { label: "Runs / game", a: f1(perGame(af.runsSeason, "for")), b: f1(perGame(hf.runsSeason, "for")), edge: better(perGame(af.runsSeason, "for"), perGame(hf.runsSeason, "for"), 0.2) },
    { label: "Allowed / game", a: f1(perGame(af.runsSeason, "against")), b: f1(perGame(hf.runsSeason, "against")), edge: better(perGame(af.runsSeason, "against"), perGame(hf.runsSeason, "against"), 0.2, false) },
    { label: "Runs L10", a: f1(perGame(af.runsLast10, "for")), b: f1(perGame(hf.runsLast10, "for")), edge: better(perGame(af.runsLast10, "for"), perGame(hf.runsLast10, "for"), 0.4) },
    { label: "Starter", a: ap ? ap.fullName.split(" ").at(-1)! : "TBD", b: hp ? hp.fullName.split(" ").at(-1)! : "TBD" },
    { label: "Starter ERA", a: era(ap?.era), b: era(hp?.era), edge: better(ap?.era ?? null, hp?.era ?? null, 0.25, false) },
    { label: "ERA last 5 starts", a: era(startSplitEraPerNine(ap?.last5Starts ?? null)), b: era(startSplitEraPerNine(hp?.last5Starts ?? null)), edge: better(startSplitEraPerNine(ap?.last5Starts ?? null), startSplitEraPerNine(hp?.last5Starts ?? null), 0.4, false) },
    { label: "Starter W-L", a: ap ? `${ap.wins}-${ap.losses}` : "—", b: hp ? `${hp.wins}-${hp.losses}` : "—" },
    { label: "Bullpen ERA", a: era(pen(matchup.awayBullpen)), b: era(pen(matchup.homeBullpen)), edge: better(pen(matchup.awayBullpen), pen(matchup.homeBullpen), 0.25, false) },
    { label: "Pen used lately", a: workload(matchup.awayBullpenRecentWorkload), b: workload(matchup.homeBullpenRecentWorkload) },
  ];

  // Each input's push on the win chance, in percentage points toward the away side.
  const factors: Factor[] = [];
  const d = prob?.drivers;
  const toPts = (logit: number) => logit * 25; // near 50%, one logit ≈ 25 points
  if (d) {
    const k = 6 * 0.2; // STRENGTH_SENSITIVITY × calibration shrink (winProbability.ts)
    if (d.away.formScore !== null && d.home.formScore !== null) {
      const v = toPts((d.away.formScore - d.home.formScore) * 0.6 * k);
      factors.push({ label: "Team form", value: v, display: `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} pts` });
    }
    if (d.away.pitcherQualityScore !== null && d.home.pitcherQualityScore !== null) {
      const v = toPts((d.away.pitcherQualityScore - d.home.pitcherQualityScore) * 0.4 * k);
      factors.push({ label: "Starting pitching", value: v, display: `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} pts` });
    }
    const hfa = -toPts(Math.log(0.54 / 0.46));
    factors.push({ label: "Home field", value: hfa, display: `${hfa >= 0 ? "+" : "−"}${Math.abs(hfa).toFixed(1)} pts` });
  }

  return (
    <>
      <ValueStrip
        rows={rows}
        footnote={
          <>
            ARCHR&apos;s chance is its model (starters, form, runs) blended with the books&apos; no-vig line; edge is what the best price returns at that chance.{" "}
            <Link href="/models" className="font-semibold text-foreground underline-offset-2 hover:underline">
              How accurate is it?
            </Link>
          </>
        }
      />
      <TaleOfTape rows={tape} a={a} b={b} />
      <WhyPanel
        factors={factors}
        a={a}
        b={b}
        footnote={
          runs?.home != null && runs.away != null
            ? `Projected ${away.abbreviation} ${runs.away.toFixed(1)} – ${home.abbreviation} ${runs.home.toFixed(1)}. Starters' ERA blends the season with their last 10 and 5 starts; form blends the home/road split with the last 10 and 5.`
            : undefined
        }
      />
    </>
  );
}
