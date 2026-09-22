import type { Metadata } from "next";
import Link from "next/link";
import { fetchNflGames } from "@/lib/nfl/games";
import { fetchCurrentNflSchedule } from "@/lib/nfl/research/espnSchedule";
import { buildNflEloAsOf } from "@/lib/nfl/research/eloAsOf";
import { buildNflResearchSlate } from "@/lib/nfl/research/predictionCapture";
import { NFL_RESEARCH_MODEL_KEY, NFL_RESEARCH_MODEL_VERSION } from "@/lib/nfl/research/modelIdentity";
import { NflResearchGameCard } from "@/components/nfl-research/NflResearchGameCard";
import { RecordSnapshotButton } from "@/components/nfl-research/RecordSnapshotButton";
import { Badge } from "@/components/ui/badge";
import { PageShell, PageHeader } from "@/components/PageShell";
import { EmptyState } from "@/components/EmptyState";

/**
 * NFL research vertical slice — see docs/architecture/NFL-RESEARCH.md for
 * the full design. Isolated from `/nfl` (production line-shopping): reads
 * only free ESPN/nflverse data, writes only to the generic
 * `PredictionRun`/`ModelPrediction` tables via a deliberate, user-triggered
 * action. Never touches `Game`, `OddsSnapshot`, Discord, or `listPlays()`.
 *
 * Presentation-only pass (see the task that produced this revision): every
 * number, warning, and disclosure below is unchanged from the original
 * implementation — only layout/hierarchy moved. The full methodology text
 * that used to sit in a permanent banner now lives in a collapsed `<details>`
 * disclosure; nothing was deleted.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "NFL research — experimental Elo (signal-only)",
  description:
    "Experimental, signal-only NFL win-probability research: free-data team Elo, pregame only. Calibration-honest but historically loses to the closing line — not a proven edge, not a recommendation.",
};

export default async function NflResearchPage() {
  let schedule: Awaited<ReturnType<typeof fetchCurrentNflSchedule>> = [];
  let nflverseGames: Awaited<ReturnType<typeof fetchNflGames>> = [];
  let fetchFailed = false;

  try {
    [schedule, nflverseGames] = await Promise.all([fetchCurrentNflSchedule(), fetchNflGames()]);
  } catch {
    fetchFailed = true;
  }

  const now = new Date();
  const eloBook = buildNflEloAsOf(nflverseGames, now);
  const slate = buildNflResearchSlate({ schedule, eloBook, generatedAt: now });

  return (
    <PageShell width="2xl">
      <PageHeader
        title="NFL Research"
        right={
          <Badge variant="outline" className="border-amber-400 text-amber-700 dark:border-amber-500 dark:text-amber-300">
            Experimental
          </Badge>
        }
        description="Free-data team-Elo win probabilities for this week's games — signal-only, not a betting product."
      />

      <details className="mt-3 rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground open:pb-3">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-foreground">
          Model status and limitations
        </summary>
        <div className="space-y-2 px-3 leading-relaxed">
          <p>
            <span className="font-mono">{NFL_RESEARCH_MODEL_KEY}</span> {NFL_RESEARCH_MODEL_VERSION} is a free-data
            team-Elo model. It is calibration-honest — its stated probabilities roughly match realized outcomes —
            but its own closing-line backtest shows it loses to the closing line (
            <code className="rounded bg-muted px-1 py-0.5">npm run backtest:nfl:clv</code>). Nothing on this page is
            a recommendation, a pick, a unit, or a claim that this model beats the market. It produces win
            probabilities and an expected margin only — no totals, no player props, no spread-cover or over/under
            probability.
          </p>
          <p>
            Full design and validation notes: <code className="rounded bg-muted px-1 py-0.5">docs/architecture/NFL-RESEARCH.md</code> and{" "}
            <code className="rounded bg-muted px-1 py-0.5">docs/architecture/calibration.md</code>. See also{" "}
            <Link href="/nfl" className="underline">
              /nfl
            </Link>{" "}
            for the production line-shopping page (unrelated to this research board).
          </p>
        </div>
      </details>

      {fetchFailed ? (
        <EmptyState title="Couldn't load NFL schedule/history" arrow="miss" supportContext="nfl-research-fetch-failed">
          ESPN or nflverse didn&apos;t respond. This is a live fetch failure, not an empty week — try reloading in a
          moment.
        </EmptyState>
      ) : slate.eligible.length === 0 ? (
        <EmptyState title="No scheduled NFL games to predict right now" arrow="miss" supportContext="nfl-research-empty">
          Every game this week is already final, in progress, or otherwise not eligible for a pregame projection.
        </EmptyState>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {slate.eligible.map(({ game, homeIdentity, awayIdentity, prediction }) => (
            <NflResearchGameCard
              key={game.espnEventId}
              game={game}
              homeIdentity={homeIdentity}
              awayIdentity={awayIdentity}
              prediction={prediction}
            />
          ))}
        </div>
      )}

      {slate.exclusions.length > 0 ? (
        <details className="mt-4 rounded-lg border border-border bg-muted/30 text-[11px] text-muted-foreground open:pb-3">
          <summary className="cursor-pointer select-none px-3 py-2 font-medium text-foreground">
            {slate.exclusions.length} game{slate.exclusions.length === 1 ? "" : "s"} not shown
          </summary>
          <ul className="flex flex-col gap-0.5 px-3">
            {slate.exclusions.map((e, i) => (
              <li key={i}>
                {e.reason}
                {e.detail ? ` — ${e.detail}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {!fetchFailed && slate.eligible.length > 0 ? (
        <div className="mt-8 border-t border-border pt-5">
          <p className="text-xs text-muted-foreground">
            Saves a frozen, timestamped copy of every projection shown above to this app&apos;s prediction-history
            record — for later honesty checks against real outcomes, not for posting or staking anywhere.
          </p>
          <div className="mt-2">
            <RecordSnapshotButton />
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
