/**
 * A tennis match on the shared matchup pieces: the face-off with ARCHR's win
 * chance (each player's career Elo from the ATP/WTA archive, the tennis
 * calibration shrink, blended with the books' no-vig line), ARCHR vs the book
 * on the moneyline, and the tale of the tape (Elo overall and by surface).
 */
import Link from "next/link";
import type { GameLineRow } from "@/lib/queries/games";
import type { MatchSummary } from "@/lib/queries/tennisMatches";
import { DEFAULT_ELO, eloExpectation } from "@/lib/tennis/elo";
import { shrinkLogit } from "@/lib/propModel/distribution";
import { blendWithMarket, DEFAULT_MODEL_WEIGHT } from "@/lib/propModel/market";
import { marketConsensus } from "@/lib/odds/lineEconomics";
import { calculateEv } from "@/lib/odds/devig";
import { isBettableBook } from "@/lib/odds/bestPrice";
import { decimalToAmerican, formatAmerican } from "@/lib/odds/americanOdds";
import { TennisPlayerBadge } from "@/components/TennisPlayerBadge";
import { FaceOff, SIDE_A_COLOR, SIDE_B_COLOR, TaleOfTape, ValueStrip, type TapeRowData } from "./Matchup";

export interface TennisRatingRow {
  overall: number;
  hard: number | null;
  clay: number | null;
  grass: number | null;
  nOverall: number;
}

/** Below this many career matches, a rating isn't trusted on its own. */
const MIN_MATCHES = 10;
const fair = (p: number) => formatAmerican(Math.round(decimalToAmerican(1 / Math.min(0.995, Math.max(0.005, p)))));
const surname = (n: string) => n.split(" ").at(-1)!;

/** Side A is the away player (listed first), B the home. Null when either lacks a trusted rating and no market exists. */
export function tennisChance(away: TennisRatingRow | null, home: TennisRatingRow | null, lines: GameLineRow[]): { pAway: number; source: "model" | "blend" | "market" } | null {
  const mkt = marketConsensus(lines, "h2h");
  const marketAway = mkt.fairProbB; // h2h pairs home (A) / away (B)
  if (away && home && away.nOverall >= MIN_MATCHES && home.nOverall >= MIN_MATCHES) {
    const model = shrinkLogit(eloExpectation(away.overall, home.overall), DEFAULT_ELO.calibrationShrink);
    return marketAway === null ? { pAway: model, source: "model" } : { pAway: blendWithMarket(model, marketAway, DEFAULT_MODEL_WEIGHT), source: "blend" };
  }
  return marketAway === null ? null : { pAway: marketAway, source: "market" };
}

export function TennisMatchBreakdown({ match, lines, away, home, when }: { match: MatchSummary; lines: GameLineRow[]; away: TennisRatingRow | null; home: TennisRatingRow | null; when: string }) {
  const chance = tennisChance(away, home, lines);
  const best = (side: "home" | "away") =>
    lines.filter((l) => l.marketType === "h2h" && l.side === side && isBettableBook(l.bookKey)).reduce<GameLineRow | null>((b, l) => (!b || l.priceAmerican > b.priceAmerican ? l : b), null);
  const sub = (r: TennisRatingRow | null) => (r ? `Elo ${Math.round(r.overall)} · ${r.nOverall} matches` : "Unrated");

  const rows = [];
  if (chance) {
    const ba = best("away");
    const bh = best("home");
    const evA = ba ? calculateEv(chance.pAway, ba.priceAmerican) : null;
    const evH = bh ? calculateEv(1 - chance.pAway, bh.priceAmerican) : null;
    const pickAway = evA !== null || evH !== null ? (evA ?? -Infinity) >= (evH ?? -Infinity) : chance.pAway >= 0.5;
    const line = pickAway ? ba : bh;
    rows.push({
      market: "Moneyline",
      pick: pickAway ? match.awayPlayer.name : match.homePlayer.name,
      fair: fair(pickAway ? chance.pAway : 1 - chance.pAway),
      best: line ? { priceAmerican: line.priceAmerican, bookKey: line.bookKey, bookName: line.bookName } : null,
      edge: pickAway ? evA : evH,
    });
  }

  const elo = (x: number | null | undefined) => (x === null || x === undefined ? "—" : String(Math.round(x)));
  const edge = (x: number | null | undefined, y: number | null | undefined): "a" | "b" | null =>
    x === null || x === undefined || y === null || y === undefined || Math.abs(x - y) < 25 ? null : x > y ? "a" : "b";
  const tape: TapeRowData[] = [
    { label: "Elo overall", a: elo(away?.overall), b: elo(home?.overall), edge: edge(away?.overall, home?.overall) },
    { label: "Hard", a: elo(away?.hard), b: elo(home?.hard), edge: edge(away?.hard, home?.hard) },
    { label: "Clay", a: elo(away?.clay), b: elo(home?.clay), edge: edge(away?.clay, home?.clay) },
    { label: "Grass", a: elo(away?.grass), b: elo(home?.grass), edge: edge(away?.grass, home?.grass) },
    { label: "Career matches", a: away ? String(away.nOverall) : "—", b: home ? String(home.nOverall) : "—" },
  ];

  return (
    <>
      <FaceOff
        a={{ name: match.awayPlayer.name, sub: sub(away), badge: <TennisPlayerBadge name={match.awayPlayer.name} size={72} />, color: SIDE_A_COLOR }}
        b={{ name: match.homePlayer.name, sub: sub(home), badge: <TennisPlayerBadge name={match.homePlayer.name} size={72} />, color: SIDE_B_COLOR }}
        probA={chance?.pAway ?? null}
        probLabel={chance?.source === "market" ? "Market win probability (no-vig) · no ARCHR rating yet" : "ARCHR win probability"}
        meta={when}
      />
      <ValueStrip
        rows={rows}
        footnote={
          <>
            ARCHR&apos;s chance is the players&apos; career Elo (ATP/WTA archive), calibrated, blended with the books&apos; no-vig line; edge is what the best price returns at that chance.{" "}
            <Link href="/models" className="font-semibold text-foreground underline-offset-2 hover:underline">
              How accurate is it?
            </Link>
          </>
        }
      />
      {(away || home) && <TaleOfTape rows={tape} a={{ label: surname(match.awayPlayer.name), color: SIDE_A_COLOR }} b={{ label: surname(match.homePlayer.name), color: SIDE_B_COLOR }} />}
    </>
  );
}
