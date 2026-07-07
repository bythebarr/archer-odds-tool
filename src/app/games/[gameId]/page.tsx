import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getGameWithLines } from "@/lib/queries/games";
import { getTeamHitRates } from "@/lib/queries/hitRate";
import { getGameMatchup } from "@/lib/queries/matchup";
import { h2hMarketConsensus } from "@/lib/odds/lineEconomics";
import { computeArcherWinProbability } from "@/lib/archer/winProbability";
import { computeExpectedRuns } from "@/lib/archer/expectedRuns";
import { GameLinesView } from "@/components/GameLinesView";
import { MatchupPanel } from "@/components/MatchupPanel";
import { TeamBadge } from "@/components/TeamBadge";
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
  const [homeHitRates, awayHitRates, matchup] = await Promise.all([
    getTeamHitRates(game.homeTeam.id),
    getTeamHitRates(game.awayTeam.id),
    getGameMatchup(gameId),
  ]);

  const marketH2h = h2hMarketConsensus(lines);
  const archerProb = matchup ? computeArcherWinProbability(matchup) : null;
  const archerRuns = matchup ? computeExpectedRuns(matchup) : null;

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <BackLink fallbackHref="/" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
        ← Back
      </BackLink>

      <h1 className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-semibold text-foreground">
        <span className="inline-flex items-center gap-2">
          <TeamBadge abbreviation={game.awayTeam.abbreviation} name={game.awayTeam.name} size={24} />
          {game.awayTeam.name}
        </span>
        <span>@</span>
        <span className="inline-flex items-center gap-2">
          <TeamBadge abbreviation={game.homeTeam.abbreviation} name={game.homeTeam.name} size={24} />
          {game.homeTeam.name}
        </span>
      </h1>
      <p className="text-sm text-muted-foreground">
        {new Intl.DateTimeFormat("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/New_York",
        }).format(game.scheduledStartUtc)}{" "}
        ET · {game.status}
      </p>

      {matchup && archerProb && archerRuns && (
        <div className="mt-6">
          <MatchupPanel
            game={game}
            matchup={matchup}
            archerProb={archerProb}
            archerRuns={archerRuns}
            marketProb={marketH2h}
          />
        </div>
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
    </div>
  );
}
