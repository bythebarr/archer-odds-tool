import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getGameWithLines } from "@/lib/queries/games";
import { getTeamHitRates } from "@/lib/queries/hitRate";
import { getGameMatchup } from "@/lib/queries/matchup";
import { getRecentTeamPlayersBatch } from "@/lib/queries/props";
import { h2hMarketConsensus } from "@/lib/odds/lineEconomics";
import { computeArcherWinProbability } from "@/lib/archer/winProbability";
import { computeExpectedRuns } from "@/lib/archer/expectedRuns";
import { GameLinesView } from "@/components/GameLinesView";
import { MatchupPanel } from "@/components/MatchupPanel";
import { PlayerPropsSection } from "@/components/PlayerPropsSection";
import { MlbBreakdown, MlbFaceOff } from "@/components/matchup/MlbGameBreakdown";
import { BackLink } from "@/components/BackLink";

/** Shares getGameWithLines's per-request cache with the page component below, so this costs no extra DB round-trip. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ gameId: string }>;
}): Promise<Metadata> {
  const { gameId } = await params;
  const result = await getGameWithLines(gameId);
  if (!result) return {};

  const { game } = result;
  const title = `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`;
  const description = `${game.awayTeam.name} at ${game.homeTeam.name} — line-shopping, hit-rates, and EV.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { title, description },
  };
}

export default async function GamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  const result = await getGameWithLines(gameId);
  if (!result) notFound();

  const { game, lines } = result;
  const [homeHitRates, awayHitRates, matchup, playersByTeam] = await Promise.all([
    getTeamHitRates(game.homeTeam.id),
    getTeamHitRates(game.awayTeam.id),
    getGameMatchup(gameId),
    getRecentTeamPlayersBatch([game.homeTeam.id, game.awayTeam.id]),
  ]);

  const marketH2h = h2hMarketConsensus(lines);
  const archerProb = matchup ? computeArcherWinProbability(matchup) : null;
  const archerRuns = matchup ? computeExpectedRuns(matchup) : null;

  const when = `${new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(game.scheduledStartUtc)} ET`;

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-10 pt-5 font-sans">
      <BackLink fallbackHref="/mlb" className="text-sm text-muted-foreground hover:text-foreground">
        ← MLB
      </BackLink>

      <h1 className="sr-only">
        {game.awayTeam.name} at {game.homeTeam.name}
      </h1>

      <MlbFaceOff game={game} matchup={matchup} prob={archerProb} runs={archerRuns} when={when} />
      {matchup && <MlbBreakdown game={game} lines={lines} matchup={matchup} prob={archerProb} runs={archerRuns} />}

      {matchup && archerProb && archerRuns && (
        <details className="group mt-6 rounded-xl border border-border bg-card">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Every model input
            <span className="transition-transform group-open:rotate-90" aria-hidden>
              ›
            </span>
          </summary>
          <div className="border-t border-border p-3">
            <MatchupPanel game={game} matchup={matchup} archerProb={archerProb} archerRuns={archerRuns} marketProb={marketH2h} />
          </div>
        </details>
      )}

      <div className="mt-8">
        <GameLinesView
          game={game}
          lines={lines}
          homeHitRates={homeHitRates}
          awayHitRates={awayHitRates}
          archerWinProb={archerProb ? { home: archerProb.homeProb, away: archerProb.awayProb } : null}
          archerRuns={archerRuns}
        />
      </div>

      <div className="mt-8">
        <PlayerPropsSection
          game={game}
          homePlayers={playersByTeam[game.homeTeam.id] ?? []}
          awayPlayers={playersByTeam[game.awayTeam.id] ?? []}
        />
      </div>
    </div>
  );
}
