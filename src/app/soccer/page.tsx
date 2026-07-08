import type { Metadata } from "next";
import { listSoccerMatchesWithLines } from "@/lib/queries/soccerMatches";
import type { SoccerMatchSummary } from "@/lib/queries/soccerMatches";
import type { GameLineRow } from "@/lib/queries/games";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { bestLinesBySide } from "@/lib/odds/bestPrice";
import { SoccerTeamBadge } from "@/components/SoccerTeamBadge";
import { MatchCard, type MatchCardChip } from "@/components/MatchCard";
import { PageShell, PageHeader } from "@/components/PageShell";
import { EmptyState } from "@/components/EmptyState";
import { getFeedFreshness } from "@/lib/freshness";

// Same rationale as the tennis page: odds update via cron, not deploys, so
// this must not be statically prerendered at build time.
export const metadata: Metadata = {
  title: "World Cup Soccer — 3-way odds",
  description:
    "3-way moneyline odds line-shopping for World Cup soccer — compare the best price across books for home, draw, and away.",
};

export const dynamic = "force-dynamic";

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(date);
}

/** Best (highest decimal-odds) price per side — moneyline (3-way) only, soccer v1 has no other market. */
function bestPricePreview(match: SoccerMatchSummary, lines: GameLineRow[]): MatchCardChip[] {
  return bestLinesBySide(lines, ["away", "draw", "home"]).map((line) => ({
    label: line.side === "home" ? match.homeTeam.abbreviation : line.side === "away" ? match.awayTeam.abbreviation : "Draw",
    value: formatAmerican(line.priceAmerican),
  }));
}

export default async function SoccerPage() {
  const [matches, freshness] = await Promise.all([listSoccerMatchesWithLines(), getFeedFreshness("soccerOdds")]);

  return (
    <PageShell width="2xl">
      <PageHeader
        title="World Cup Soccer"
        description="Odds line-shopping — moneyline (3-way) only, no Market EV yet."
      />

      {matches.length === 0 ? (
        <EmptyState title="No World Cup matches tracked right now" freshness={freshness} arrow="miss" supportContext="soccer-empty">
          Between match windows there&apos;s nothing to price — odds reappear as the next fixtures approach.
        </EmptyState>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {matches.map(({ match, lines }) => (
            <MatchCard
              key={match.id}
              href={`/soccer/${match.id}`}
              competitors={[
                {
                  badge: <SoccerTeamBadge abbreviation={match.awayTeam.abbreviation} name={match.awayTeam.name} size={28} />,
                  label: match.awayTeam.name,
                },
                {
                  badge: <SoccerTeamBadge abbreviation={match.homeTeam.abbreviation} name={match.homeTeam.name} size={28} />,
                  label: match.homeTeam.name,
                },
              ]}
              timeLabel={`${formatTime(match.scheduledStartUtc)} ET`}
              status={match.status}
              isLive={match.status === "live"}
              chips={bestPricePreview(match, lines)}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}
