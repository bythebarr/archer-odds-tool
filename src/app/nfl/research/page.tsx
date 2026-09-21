import type { Metadata } from "next";
import Link from "next/link";
import { fetchNflGames } from "@/lib/nfl/games";
import { fetchCurrentNflSchedule } from "@/lib/nfl/research/espnSchedule";
import { buildNflEloAsOf } from "@/lib/nfl/research/eloAsOf";
import { buildNflResearchSlate } from "@/lib/nfl/research/predictionCapture";
import { NFL_RESEARCH_MODEL_KEY, NFL_RESEARCH_MODEL_VERSION } from "@/lib/nfl/research/modelIdentity";
import { NflResearchGameCard } from "@/components/nfl-research/NflResearchGameCard";
import { RecordSnapshotButton } from "@/components/nfl-research/RecordSnapshotButton";
import { PageShell, PageHeader } from "@/components/PageShell";
import { EmptyState } from "@/components/EmptyState";

/**
 * NFL research vertical slice — see docs/architecture/NFL-RESEARCH.md for
 * the full design. Isolated from `/nfl` (production line-shopping): reads
 * only free ESPN/nflverse data, writes only to the generic
 * `PredictionRun`/`ModelPrediction` tables via a deliberate, user-triggered
 * action. Never touches `Game`, `OddsSnapshot`, Discord, or `listPlays()`.
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
        title="NFL research"
        description="Experimental, signal-only Elo win-probability research — free data only, pregame only."
      />

      <div className="mt-4 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-200">
        <p className="font-semibold uppercase tracking-wide">Experimental · signal-only</p>
        <p className="mt-1">
          {NFL_RESEARCH_MODEL_KEY} {NFL_RESEARCH_MODEL_VERSION} — a free-data team-Elo model. It is
          calibration-honest (its stated probabilities roughly match realized outcomes) but its own closing-line
          backtest (<code>npm run backtest:nfl:clv</code>, see docs/architecture/calibration.md) shows it loses to
          the closing line. Nothing on this page is a recommendation, a pick, a unit, or a claim that this model
          beats the market. It produces win probabilities and an expected margin only — no totals, no player props,
          no spread-cover or over/under probability.
        </p>
      </div>

      <div className="mt-4">
        <RecordSnapshotButton />
      </div>

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
        <div className="mt-6 flex flex-col gap-3">
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
        <div className="mt-6 rounded-lg border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
          <p className="font-semibold uppercase tracking-wide">
            {slate.exclusions.length} game{slate.exclusions.length === 1 ? "" : "s"} not shown
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {slate.exclusions.map((e, i) => (
              <li key={i}>
                {e.reason}
                {e.detail ? ` — ${e.detail}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-6 text-[11px] text-muted-foreground/70">
        Full design, limitations, and future work: docs/architecture/NFL-RESEARCH.md. See also{" "}
        <Link href="/nfl" className="underline">
          /nfl
        </Link>{" "}
        for the production line-shopping page (unrelated to this research board).
      </p>
    </PageShell>
  );
}
