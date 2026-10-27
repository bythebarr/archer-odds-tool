/**
 * The matchup breakdown for any game in the all-sports engine, on the same
 * pieces as UFC and the NBA/NFL pages: the face-off, ARCHR vs the book, how
 * the model and market each see it, the tale of the tape, why ARCHR prices it
 * this way, and the last meetings.
 */
import Link from "next/link";
import type { EventPage } from "@/lib/queries/allSports";
import { mainOffer, type Offer } from "@/lib/gameModel/offers";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { Logo } from "@/components/Logo";
import { FaceOff, SectionTitle, SIDE_A_COLOR, SIDE_B_COLOR, TaleOfTape, ValueStrip, WhyPanel, type Factor, type TapeRowData, type ValueRow } from "@/components/matchup/Matchup";

const US_ORDER = new Set(["football", "basketball", "hockey", "baseball", "lacrosse"]);
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);
const signedLine = (x: number) => (x === 0 ? "PK" : x > 0 ? `+${x}` : `−${Math.abs(x)}`);
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join("");
const short = (name: string) => (name.length > 18 ? name.split(" ").at(-1)! : name);

/** Which side sits left: away for US sports (books list "away @ home"), home everywhere else. */
export function sidesOf(view: EventPage) {
  const awayFirst = US_ORDER.has(view.sport.key);
  const a = awayFirst ? "away" : "home";
  const b = awayFirst ? "home" : "away";
  return { a, b, awayFirst } as const;
}

export function EventFaceOff({ view, when }: { view: EventPage; when: string }) {
  const { a, b, awayFirst } = sidesOf(view);
  const r = view.ratings;
  const formOf = (side: "home" | "away") => {
    const f = r[side].form;
    if (f.games === 0) return side === "home" ? "Home" : "Away";
    const rec = view.sport.family === "goals" && view.sport.key !== "hockey" ? `${f.wins}-${f.draws}-${f.losses}` : `${f.wins}-${f.losses}`;
    return `${rec} · ${side === "home" ? "Home" : "Away"}`;
  };
  const badge = (side: "home" | "away") => {
    const name = view[side];
    return <Logo sources={[side === "home" ? view.homeLogo : view.awayLogo]} alt={name} fallbackText={initials(name)} size={72} />;
  };
  const probA = view.probs ? (a === "home" ? view.probs.home : view.probs.away) : null;
  const draw = view.probs && view.probs.draw > 0 ? view.probs.draw : null;

  let line: string | null = null;
  const e = r.expected;
  if (e && r.family === "goals") line = `ARCHR xG ${short(view.home)} ${e.home.toFixed(1)} – ${e.away.toFixed(1)} ${short(view.away)}`;
  else if (e && r.family === "points") {
    const margin = Math.round((e.home - e.away) * 2) / 2;
    line = `ARCHR line ${short(view.home)} ${signedLine(-margin)} · O/U ${(Math.round((e.home + e.away) * 2) / 2).toFixed(1)}`;
  } else if (r.family === "winner" && r.home.games > 0 && r.away.games > 0) line = `ARCHR rating ${Math.round(r.home.strength)} vs ${Math.round(r.away.strength)}`;

  return (
    <FaceOff
      a={{ name: view[a], sub: formOf(a), badge: badge(a), color: SIDE_A_COLOR }}
      b={{ name: view[b], sub: formOf(b), badge: badge(b), color: SIDE_B_COLOR }}
      probA={probA}
      draw={draw}
      probLabel={draw !== null ? `ARCHR win probability · draw ${pct(draw)}` : "ARCHR win probability"}
      center={awayFirst ? "@" : "VS"}
      meta={when}
      chips={
        <>
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[#eef0f4]">{view.league.name}</span>
          {line && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[#eef0f4]">{line}</span>}
        </>
      }
    />
  );
}

/** The side ARCHR prefers on one offer (highest EV), as a ValueStrip row. */
function valueRow(o: Offer | null, market: string, view: EventPage): ValueRow | null {
  if (!o) return null;
  const sides = o.sides.filter((s) => s.best && s.ev !== null);
  if (sides.length === 0) return null;
  const s = sides.sort((x, y) => y.ev! - x.ev!)[0]!;
  const name = (side: string) => (side === "home" ? short(view.home) : side === "away" ? short(view.away) : side === "draw" ? "Draw" : side === "yes" ? "Yes" : side === "no" ? "No" : side === "over" ? "Over" : "Under");
  const pick =
    o.kind === "spread" ? `${name(s.side)} ${signedLine(s.point)}` : o.kind === "total" ? `${name(s.side)} ${s.point}` : name(s.side);
  return { market, pick, fair: s.fairAmerican !== null ? formatAmerican(s.fairAmerican) : "—", best: s.best ? { priceAmerican: s.best.priceAmerican, bookKey: s.best.bookKey, bookName: s.best.bookName } : null, edge: s.ev };
}

export function EventBreakdown({ view }: { view: EventPage }) {
  const { a, b } = sidesOf(view);
  const r = view.ratings;
  const game = view.offers.filter((o) => o.period === "game");
  const ml = game.find((o) => o.kind === "ml") ?? null;
  const rows = [
    valueRow(ml, ml?.sides.some((s) => s.side === "draw") ? "Match result" : "Moneyline", view),
    valueRow(mainOffer(game.filter((o) => o.kind === "spread")), r.family === "goals" ? "Handicap" : "Spread", view),
    valueRow(mainOffer(game.filter((o) => o.kind === "total")), "Total", view),
    valueRow(game.find((o) => o.kind === "btts") ?? null, "Both teams to score", view),
  ].filter((x): x is ValueRow => x !== null);

  const la = { label: short(view[a]), color: SIDE_A_COLOR };
  const lb = { label: short(view[b]), color: SIDE_B_COLOR };
  const better = (x: number | null, y: number | null, gap: number, higher = true): "a" | "b" | null => {
    if (x === null || y === null || Math.abs(x - y) < gap) return null;
    return (higher ? x > y : x < y) ? "a" : "b";
  };
  const ra = r[a];
  const rb = r[b];
  const unit = r.family === "goals" ? (view.sport.key === "hockey" ? "goals" : "goals") : "pts";
  const scoreGap = r.family === "points" ? Math.max(1, r.avgScore * 0.03) : 0.15;
  const draws = r.family === "goals" && view.sport.key !== "hockey";
  const rec = (f: typeof ra.form) => (f.games === 0 ? "—" : draws ? `${f.wins}-${f.draws}-${f.losses}` : `${f.wins}-${f.losses}`);
  const f1 = (x: number | null) => (x === null ? "—" : x.toFixed(r.family === "points" ? 1 : 2));
  const strength = (x: number) => (r.family === "winner" ? `${Math.round(x)}` : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(r.family === "points" ? 1 : 2)}`);

  const tape: TapeRowData[] = [
    { label: "Record (rated games)", a: rec(ra.form), b: rec(rb.form), edge: better(ra.form.wins - ra.form.losses, rb.form.wins - rb.form.losses, 1) },
    { label: "Last 5", a: ra.form.last5.join(" ") || "—", b: rb.form.last5.join(" ") || "—", edge: better(ra.form.last5.filter((x) => x === "W").length, rb.form.last5.filter((x) => x === "W").length, 1) },
    ...(r.family === "winner"
      ? []
      : [
          { label: `Scored / game (last 10)`, a: f1(ra.form.scored), b: f1(rb.form.scored), edge: better(ra.form.scored, rb.form.scored, scoreGap) },
          { label: `Allowed / game (last 10)`, a: f1(ra.form.allowed), b: f1(rb.form.allowed), edge: better(ra.form.allowed, rb.form.allowed, scoreGap, false) },
        ]),
    {
      label: r.family === "winner" ? "ARCHR rating (Elo)" : `ARCHR strength (${unit} vs avg)`,
      a: ra.games ? strength(ra.strength) : "—",
      b: rb.games ? strength(rb.strength) : "—",
      edge: ra.games && rb.games ? better(ra.strength, rb.strength, r.family === "winner" ? 15 : scoreGap / 2) : null,
    },
    { label: "Games rated", a: String(ra.games), b: String(rb.games), edge: null },
  ];

  // The expected margin, decomposed: team strength and where it's played.
  const factors: Factor[] = [];
  if (r.family !== "winner" && r.expected) {
    const sign = a === "home" ? 1 : -1;
    // The home side's extra expected score; the rest of the projected margin is the teams themselves.
    const edge = r.homeEdge;
    const total = (r.expected.home - r.expected.away) * sign;
    const homePush = (a === "home" ? 1 : -1) * edge;
    factors.push({ label: "Team strength", value: total - homePush, display: `${total - homePush > 0 ? "+" : "−"}${Math.abs(total - homePush).toFixed(2)} ${unit}` });
    factors.push({ label: "Home edge", value: homePush, display: `${homePush > 0 ? "+" : "−"}${Math.abs(homePush).toFixed(2)} ${unit}` });
  } else if (r.family === "winner" && ra.games && rb.games) {
    const gap = ra.strength - rb.strength;
    factors.push({ label: "Rating gap", value: gap / 100, display: `${gap > 0 ? "+" : "−"}${Math.abs(Math.round(gap))} Elo` });
  }

  const mp = r.modelProbs;
  const market = ml ? Object.fromEntries(ml.sides.map((s) => [s.side, s.marketProb])) : {};
  const blend = view.probs;
  const pctSide = (o: Record<string, number | null | undefined> | null, side: string) => pct(o ? o[side] ?? null : null);

  return (
    <>
      <ValueStrip
        rows={rows}
        footnote={
          view.modelWeight > 0 ? (
            <>
              ARCHR&apos;s fair price is the {view.sport.label.toLowerCase()} model blended with the books&apos; no-vig consensus (sharp books weighted up); the model counts {Math.round(view.modelWeight * 100)}% here. Edge is what the best price returns at that chance.{" "}
              <Link href="/models" className="font-semibold text-foreground underline-offset-2 hover:underline">
                How accurate is it?
              </Link>
            </>
          ) : (
            <>Market read: one side has under three rated games, so the model sits out and ARCHR&apos;s fair price is the books&apos; no-vig consensus. Edge is the best price against it.</>
          )
        }
      />

      {ml && (
        <section className="mt-6">
          <SectionTitle>How ARCHR gets there</SectionTitle>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,4.2rem)] gap-1 border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Win chance</span>
              <span className="text-right">Model</span>
              <span className="text-right">Market</span>
              <span className="text-right text-foreground">ARCHR</span>
            </div>
            {[a, ...(ml.sides.some((s) => s.side === "draw") ? ["draw"] : []), b].map((side) => (
              <div key={side} className="grid grid-cols-[minmax(0,1fr)_repeat(3,4.2rem)] gap-1 px-3 py-2 text-sm">
                <span className="truncate font-semibold text-foreground">{side === "draw" ? "Draw" : view[side as "home" | "away"]}</span>
                <span className="text-right font-mono text-muted-foreground">{pctSide(mp as Record<string, number> | null, side)}</span>
                <span className="text-right font-mono text-muted-foreground">{pctSide(market, side)}</span>
                <span className="text-right font-mono font-bold text-foreground">{pctSide(blend as Record<string, number> | null, side)}</span>
              </div>
            ))}
            <p className="border-t border-border px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
              Model: {r.family === "goals" ? "attack/defense goals model (Poisson score grid)" : r.family === "points" ? "opponent-adjusted points ratings" : "Elo on results"}, from {r.results.toLocaleString()} {view.sport.label.toLowerCase()} results. Market: {view.books} US books de-vigged, sharp books weighted 3×.
            </p>
          </div>
        </section>
      )}

      <TaleOfTape rows={tape} a={la} b={lb} />
      <WhyPanel
        factors={factors}
        a={la}
        b={lb}
        footnote={
          r.expected
            ? `Projected ${short(view.home)} ${r.expected.home.toFixed(r.family === "points" ? 1 : 2)} – ${r.expected.away.toFixed(r.family === "points" ? 1 : 2)} ${short(view.away)}. Ratings adjust for every opponent and walk forward game by game; last season counts, faded.`
            : "Ratings move with every result, more for players new to the feed."
        }
      />

      {view.h2h.length > 0 && (
        <section className="mt-6">
          <SectionTitle>Last meetings</SectionTitle>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {view.h2h.map((m) => (
              <li key={`${m.startsAt.toISOString()}${m.home}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="text-xs text-muted-foreground">{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(m.startsAt)}</span>
                <span className="min-w-0 flex-1 truncate text-right text-foreground">
                  {m.home} <span className="font-mono font-bold">{m.homeScore}–{m.awayScore}</span> {m.away}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
