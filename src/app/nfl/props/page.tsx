import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PageShell, PageHeader } from "@/components/PageShell";
import { EmptyState } from "@/components/EmptyState";
import { NflPropsBoard } from "@/components/nfl-props/NflPropsBoard";
import { MARKET_META } from "@/components/nfl-props/marketMeta";
import { getLatestNflPropsBoard, type NflPropsBoard as BoardData } from "@/lib/nfl/props/board";

/**
 * NFL player-prop projections — see docs/architecture/NFL-PROPS-MODEL.md.
 * Reads the latest captured `nfl-props` run (written by
 * `npm run capture:nfl:props`); never re-projects, never calls an odds
 * provider. Lines and prices typed in by the viewer stay in the browser.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "NFL player props — ARCHR projections",
  description:
    "Volume × share × efficiency projections for NFL passing, rushing and receiving props, with calibrated over/under probabilities at any line.",
};

function Scorecard({ board }: { board: BoardData }) {
  if (board.validation.length === 0) return null;
  return (
    <section aria-label="Model track record" className="mt-4 rounded-xl border border-border bg-gradient-to-br from-muted/40 to-transparent p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">Holdout record · 2020–22</h2>
        <span className="text-[10px] text-muted-foreground">error vs. season average, games the model never saw</span>
      </div>
      <div className="-mx-1 mt-2 overflow-x-auto">
        <div className="flex w-max gap-2 px-1">
          {board.validation.map((v) => {
            const better = (v.maeSeasonAvg - v.maeModel) / v.maeSeasonAvg;
            return (
              <div key={v.market} className="min-w-[6.5rem] rounded-lg border border-border bg-card px-2.5 py-2">
                <div className="text-[10px] font-medium text-muted-foreground">{MARKET_META[v.market].short}</div>
                <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  −{(better * 100).toFixed(1)}%
                </div>
                <div className="text-[10px] tabular-nums text-muted-foreground">
                  {v.maeModel.toFixed(1)} vs {v.maeSeasonAvg.toFixed(1)} · n={v.n.toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default async function NflPropsPage() {
  let board: BoardData | null = null;
  let failed = false;
  try {
    board = await getLatestNflPropsBoard();
  } catch {
    failed = true;
  }

  return (
    <PageShell width="2xl">
      <PageHeader
        title={board ? `NFL Props · Week ${board.week}` : "NFL Props"}
        right={
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="border-amber-400 text-amber-700 dark:border-amber-500 dark:text-amber-300">
              Experimental
            </Badge>
            {board ? <Badge variant="secondary" className="font-mono">{board.modelVersion}</Badge> : null}
          </div>
        }
        description="Every projection is team volume × player share × efficiency × matchup. Enter any line for a calibrated over/under."
      />

      {failed ? (
        <EmptyState title="Couldn't load NFL props" arrow="miss" supportContext="nfl-props-load-failed">
          The projection store didn&apos;t respond. Try reloading in a moment.
        </EmptyState>
      ) : !board ? (
        <EmptyState title="No NFL prop projections captured yet" arrow="miss" supportContext="nfl-props-empty">
          Projections appear here after the weekly capture runs (<code>npm run capture:nfl:props</code>).
        </EmptyState>
      ) : (
        <>
          <Scorecard board={board} />

          {board.warnings.map((w, i) => (
            <p key={i} className="mt-3 text-[11px] text-amber-700 dark:text-amber-400">
              ⚠ {w}
            </p>
          ))}

          <NflPropsBoard board={board} />

          <details className="mt-6 rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground open:pb-3">
            <summary className="cursor-pointer select-none px-3 py-2 font-medium text-foreground">How this works, and what it isn&apos;t</summary>
            <div className="space-y-2 px-3 leading-relaxed">
              <p>
                Projections come from free nflverse data: weekly box scores, snap counts, schedules and the official
                injury report. Role (target, carry and attempt share) is weighted toward the last ~4 games. Per-touch
                efficiency is weighted over ~16 games and shrunk hard toward league norms, because it&apos;s mostly
                noise. Team volume follows the pregame spread and total. Players listed Out or Doubtful are removed,
                and when a runner is ruled out, his carries are redistributed to his teammates (tagged +usage).
                Questionable players are flagged Q.
              </p>
              <p>
                The model beat both the season average and the last-5 average on every market in 2020–22 holdout
                seasons. That shows it projects better than naive averages. It does <strong>not</strong> yet show
                it beats sportsbook lines: no free archive of historical NFL prop odds exists, so that is being
                measured going forward. Treat over/under percentages above ~80% as &ldquo;strong&rdquo;, not as exact.
              </p>
              <p>
                Captured {new Date(board.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET ·{" "}
                {board.rows.length} projections
                {board.excluded.length ? ` · ${board.excluded.length} players removed by injury report` : ""}. Game
                model research: <Link href="/nfl/research" className="underline">/nfl/research</Link>.
              </p>
            </div>
          </details>
        </>
      )}
    </PageShell>
  );
}
