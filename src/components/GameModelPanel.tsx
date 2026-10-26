import Link from "next/link";
import type { GameModelView, TeamRead } from "@/lib/queries/gameModel";
import type { PricedMarket } from "@/lib/gameModel";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { espnTeamLogoUrl } from "@/lib/logos";
import { Logo } from "@/components/Logo";
import { BookBadge } from "@/components/BookBadge";

/** Model edge worth highlighting — above line-timing noise once blended with the market. */
const EDGE_FLAG = 0.02;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (x: number, digits = 1) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}`;
const line = (x: number) => (x > 0 ? `+${x}` : x === 0 ? "PK" : `${x}`);

function TeamFactors({ sport, team, side }: { sport: "nba" | "nfl"; team: TeamRead; side: "Away" | "Home" }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/60 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <Logo sources={[espnTeamLogoUrl(sport, team.abbreviation)]} alt={team.name} fallbackText={team.abbreviation} size={18} />
        <span className="truncate text-xs font-semibold text-foreground">{team.abbreviation}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">{side}</span>
      </div>
      <p className="mt-1 font-mono text-sm font-semibold text-foreground">
        {signed(team.net)} <span className="font-sans text-[10px] font-medium text-muted-foreground">net / game</span>
      </p>
      <p className="text-[10px] text-muted-foreground">
        Off {signed(team.offense)} · Def {signed(-team.defense)} · {team.games} gp
      </p>
      {team.restEdge !== 0 && (
        <p className={`mt-1 text-[10px] font-semibold ${team.restEdge < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
          {sport === "nba" ? "Back-to-back" : team.restEdge > 0 ? "Off a bye" : "Short week"} {signed(team.restEdge)}
        </p>
      )}
      {team.missing.map((m) => (
        <p key={m.name} className="mt-0.5 truncate text-[10px] text-muted-foreground">
          <span className="font-semibold text-red-600 dark:text-red-400">{m.status}</span> {m.name} {signed(-m.impact)}
        </p>
      ))}
    </div>
  );
}

function MarketRow({ m, home, away }: { m: PricedMarket; home: string; away: string }) {
  const sideA = m.market === "total" ? `O ${m.point}` : m.market === "spread" ? `${home} ${line(m.point!)}` : home;
  const sideB = m.market === "total" ? `U ${m.point}` : m.market === "spread" ? `${away} ${line(-m.point!)}` : away;
  const pickA = (m.evA ?? -1) >= (m.evB ?? -1);
  const ev = pickA ? m.evA : m.evB;
  const best = pickA ? m.bestA : m.bestB;
  const flip = (p: number) => (pickA ? p : 1 - p);
  return (
    <div className="flex items-center gap-2 border-t border-border py-2.5 first:border-t-0">
      <div className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {m.market === "ml" ? "Moneyline" : m.market}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{pickA ? sideA : sideB}</p>
        <p className="text-[10px] text-muted-foreground">
          Model {pct(flip(m.modelProbA))} · Market {m.marketRead ? pct(flip(m.marketRead.probOver)) : "—"} ·{" "}
          <span className="font-semibold text-foreground">ARCHR {pct(flip(m.probA))}</span>
        </p>
      </div>
      {best && (
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="font-mono text-sm font-semibold text-foreground">{formatAmerican(best.priceAmerican)}</span>
          <BookBadge bookKey={best.bookKey} bookName={best.bookName} size={18} />
          {ev !== null && (
            <span
              className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold ${ev >= EDGE_FLAG ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground"}`}
            >
              {ev >= 0 ? "+" : ""}
              {(ev * 100).toFixed(1)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * ARCHR's game model on one NBA/NFL game: the projected score, the fair line
 * and total against the market's, each market's model / market / blended
 * chance with the best price's EV, and what built it (ratings, home edge,
 * rest, who's out).
 */
export function GameModelPanel({ view }: { view: GameModelView }) {
  const { home, away, expected } = view;
  const spread = view.markets.find((m) => m.market === "spread");
  const total = view.markets.find((m) => m.market === "total");
  const fitted = view.markets.some((m) => m.weightFitted);
  return (
    <section className="mt-4">
      <h3 className="mb-2 flex items-center gap-2 font-display text-sm font-extrabold uppercase italic tracking-wide text-foreground">
        <span className="brand-slash" aria-hidden />
        ARCHR line
      </h3>
      <div className="rounded-xl border border-border bg-card p-3.5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{away.abbreviation}</p>
            <p className="font-mono text-2xl font-semibold text-foreground">{expected.away.toFixed(1)}</p>
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">projected</div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{home.abbreviation}</p>
            <p className="font-mono text-2xl font-semibold text-foreground">{expected.home.toFixed(1)}</p>
          </div>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted" aria-label={`${home.abbreviation} ${pct(view.pHomeWin)} to win`}>
          <div className="bg-foreground/70" style={{ width: pct(1 - view.pHomeWin) }} />
          <div className="bg-brand" style={{ width: pct(view.pHomeWin) }} />
        </div>
        <div className="mt-1 flex justify-between text-[10px] font-semibold text-muted-foreground">
          <span>{pct(1 - view.pHomeWin)} win</span>
          <span>{pct(view.pHomeWin)} win</span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1.5 text-center">
          <div className="rounded-lg bg-muted/60 px-2 py-1.5">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Fair spread · market</p>
            <p className="font-mono text-sm font-semibold text-foreground">
              {home.abbreviation} {line(Math.round(view.fairSpread * 2) / 2)}
              {spread?.point != null && <span className="text-muted-foreground"> · {line(spread.point)}</span>}
            </p>
          </div>
          <div className="rounded-lg bg-muted/60 px-2 py-1.5">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Fair total · market</p>
            <p className="font-mono text-sm font-semibold text-foreground">
              {(Math.round(view.fairTotal * 2) / 2).toFixed(1)}
              {total?.point != null && <span className="text-muted-foreground"> · {total.point}</span>}
            </p>
          </div>
        </div>

        {view.markets.length > 0 && (
          <div className="mt-3">
            {view.markets.map((m) => (
              <MarketRow key={m.market} m={m} home={home.abbreviation} away={away.abbreviation} />
            ))}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <TeamFactors sport={view.sport} team={away} side="Away" />
          <TeamFactors sport={view.sport} team={home} side="Home" />
        </div>

        <p className="mt-2.5 text-[10px] leading-relaxed text-muted-foreground">
          Opponent-adjusted scoring ratings from every game played, home edge {signed(view.hfa)}, rest and who&apos;s out, as a full
          distribution of margins and totals{view.sport === "nfl" ? " weighted to football's key numbers" : ""}. Each chance is blended with the
          books&apos; no-vig consensus ({fitted ? "weights fitted on closing lines" : "a conservative default weight until the backtest fits it"}).{" "}
          <Link href="/models" className="font-semibold text-foreground underline-offset-2 hover:underline">
            How accurate is it?
          </Link>
        </p>
      </div>
    </section>
  );
}
