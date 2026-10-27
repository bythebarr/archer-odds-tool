/**
 * The NBA/NFL matchup breakdown, on the shared matchup pieces: the face-off,
 * ARCHR vs the book, the tale of the tape, and why ARCHR prices it this way.
 * Away is side A (left), home side B, the way books list a game.
 */
import Link from "next/link";
import type { GameModelView, TeamRead } from "@/lib/queries/gameModel";
import type { PricedMarket } from "@/lib/gameModel";
import { decimalToAmerican, formatAmerican } from "@/lib/odds/americanOdds";
import { espnTeamLogoUrl } from "@/lib/logos";
import { Logo } from "@/components/Logo";
import { FaceOff, SIDE_A_COLOR, SIDE_B_COLOR, TaleOfTape, ValueStrip, WhyPanel, type Factor, type TapeRowData, type ValueRow } from "./Matchup";

type Sport = "nba" | "nfl";
const nick = (name: string) => name.split(" ").at(-1)!;
const line = (x: number) => (x === 0 ? "PK" : x > 0 ? `+${x}` : `−${Math.abs(x)}`);
const half = (x: number) => Math.round(x * 2) / 2;
const pts = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(1)} pts`;
const record = (r: { w: number; l: number }) => `${r.w}-${r.l}`;

export function TeamFaceOff({ sport, view, when }: { sport: Sport; view: GameModelView; when: string }) {
  const badge = (t: TeamRead) => <Logo sources={[espnTeamLogoUrl(sport, t.abbreviation)]} alt={t.name} fallbackText={t.abbreviation} size={72} />;
  return (
    <FaceOff
      a={{ name: view.away.name, sub: `${record(view.away.record)} · Away`, badge: badge(view.away), color: SIDE_A_COLOR }}
      b={{ name: view.home.name, sub: `${record(view.home.record)} · Home`, badge: badge(view.home), color: SIDE_B_COLOR }}
      probA={1 - view.pHomeWin}
      center="@"
      meta={when}
      chips={
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[#eef0f4]">
          ARCHR line {view.home.abbreviation} {line(half(view.fairSpread))} · O/U {half(view.fairTotal).toFixed(1)}
        </span>
      }
    />
  );
}

function valueRow(m: PricedMarket, view: GameModelView): ValueRow {
  const pickA = (m.evA ?? -Infinity) >= (m.evB ?? -Infinity);
  const prob = pickA ? m.probA : 1 - m.probA;
  const best = pickA ? m.bestA : m.bestB;
  const edge = pickA ? m.evA : m.evB;
  if (m.market === "spread") {
    const team = pickA ? view.home : view.away;
    const bookPoint = pickA ? m.point! : -m.point!;
    const fair = pickA ? half(view.fairSpread) : -half(view.fairSpread);
    return { market: "Spread", pick: `${nick(team.name)} ${line(bookPoint)}`, fair: line(fair), best, bookLine: line(bookPoint), edge };
  }
  if (m.market === "total") {
    return { market: "Total", pick: `${pickA ? "Over" : "Under"} ${m.point}`, fair: half(view.fairTotal).toFixed(1), best, bookLine: `${m.point}`, edge };
  }
  const team = pickA ? view.home : view.away;
  return { market: "Moneyline", pick: nick(team.name), fair: formatAmerican(Math.round(decimalToAmerican(1 / prob))), best, edge };
}

export function TeamBreakdown({ sport, view }: { sport: Sport; view: GameModelView }) {
  const a = { label: view.away.abbreviation, color: SIDE_A_COLOR };
  const b = { label: view.home.abbreviation, color: SIDE_B_COLOR };
  const better = (x: number | null, y: number | null, minGap: number, higher = true): "a" | "b" | null => {
    if (x === null || y === null || Math.abs(x - y) < minGap) return null;
    return (higher ? x > y : x < y) ? "a" : "b";
  };
  const f1 = (x: number | null) => (x === null ? "—" : x.toFixed(1));
  const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(1)}`;
  const gap = sport === "nba" ? 1 : 0.5;
  const out = (t: TeamRead) => (t.missing.length ? `${t.missing.length} · ${nick(t.missing[0].name)}` : "None");
  const rest = (t: TeamRead) => (t.restDays === null ? "—" : `${t.restDays}d${t.restEdge < 0 ? (sport === "nba" ? " · B2B" : " · short") : t.restEdge > 0 ? " · bye" : ""}`);

  const tape: TapeRowData[] = [
    { label: "Record", a: record(view.away.record), b: record(view.home.record), edge: better(view.away.record.w - view.away.record.l, view.home.record.w - view.home.record.l, 1) },
    { label: "Last 10", a: record(view.away.last10), b: record(view.home.last10), edge: better(view.away.last10.w, view.home.last10.w, 1) },
    { label: "Points / game", a: f1(view.away.ppg), b: f1(view.home.ppg), edge: better(view.away.ppg, view.home.ppg, gap) },
    { label: "Allowed / game", a: f1(view.away.oppg), b: f1(view.home.oppg), edge: better(view.away.oppg, view.home.oppg, gap, false) },
    { label: "ARCHR net rating", a: signed(view.away.net), b: signed(view.home.net), edge: better(view.away.net, view.home.net, gap) },
    { label: "Offense (adj.)", a: signed(view.away.offense), b: signed(view.home.offense), edge: better(view.away.offense, view.home.offense, gap) },
    { label: "Defense (adj.)", a: signed(-view.away.defense), b: signed(-view.home.defense), edge: better(-view.away.defense, -view.home.defense, gap) },
    { label: "Rest", a: rest(view.away), b: rest(view.home), edge: better(view.away.restEdge, view.home.restEdge, 0.01) },
    { label: "Out / doubtful", a: out(view.away), b: out(view.home), edge: better(view.away.missing.length, view.home.missing.length, 1, false) },
  ];

  // Every push in points of margin, positive toward the away side.
  const lost = (t: TeamRead) => t.missing.reduce((s, p) => s + p.impact, 0);
  const factors: Factor[] = [
    { label: "Team strength", value: view.away.net - view.home.net, display: pts(view.away.net - view.home.net) },
    { label: "Home court", value: -view.hfa, display: pts(-view.hfa) },
    { label: "Rest", value: view.away.restEdge - view.home.restEdge, display: pts(view.away.restEdge - view.home.restEdge) },
    { label: `${view.away.abbreviation} absences`, value: -lost(view.away), display: pts(-lost(view.away)) },
    { label: `${view.home.abbreviation} absences`, value: lost(view.home), display: pts(lost(view.home)) },
  ];
  const projected = view.expected.away - view.expected.home;

  return (
    <>
      <ValueStrip
        rows={view.markets.map((m) => valueRow(m, view))}
        footnote={
          <>
            ARCHR&apos;s fair price is the game model blended with the books&apos; no-vig consensus; edge is what the best price returns at that chance.{" "}
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
        footnote={`Projected ${view.away.abbreviation} ${view.expected.away.toFixed(1)} – ${view.home.abbreviation} ${view.expected.home.toFixed(1)} (${pts(projected)} for ${view.away.abbreviation}). Ratings are adjusted for every opponent, from every game played.`}
      />
    </>
  );
}
