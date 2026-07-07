import { listSoccerMatchesWithLines } from "@/lib/queries/soccerMatches";
import type { SoccerMatchSummary } from "@/lib/queries/soccerMatches";
import type { GameLineRow } from "@/lib/queries/games";
import { americanToDecimal, formatAmerican } from "@/lib/odds/americanOdds";
import { TeamBadge } from "@/components/TeamBadge";
import { MatchCard, type MatchCardChip } from "@/components/MatchCard";

// Same rationale as the tennis page: odds update via cron, not deploys, so
// this must not be statically prerendered at build time.
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
  const bestBySide = new Map<string, GameLineRow>();
  for (const line of lines) {
    const current = bestBySide.get(line.side);
    if (!current || americanToDecimal(line.priceAmerican) > americanToDecimal(current.priceAmerican)) {
      bestBySide.set(line.side, line);
    }
  }

  return ["away", "draw", "home"]
    .map((side) => bestBySide.get(side))
    .filter((line): line is GameLineRow => line !== undefined)
    .map((line) => ({
      label: line.side === "home" ? match.homeTeam.abbreviation : line.side === "away" ? match.awayTeam.abbreviation : "Draw",
      value: formatAmerican(line.priceAmerican),
    }));
}

export default async function SoccerPage() {
  const matches = await listSoccerMatchesWithLines();

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <h1 className="text-xl font-semibold text-foreground">World Cup Soccer</h1>
      <p className="text-sm text-muted-foreground">
        World Cup soccer odds line-shopping — moneyline (3-way) only, no Market EV yet.
        Research/discovery only, no bet placement or tracking.
      </p>

      {matches.length === 0 ? (
        <p className="mt-6 py-10 text-center text-sm text-muted-foreground">
          No World Cup matches tracked right now.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {matches.map(({ match, lines }) => (
            <MatchCard
              key={match.id}
              href={`/soccer/${match.id}`}
              competitors={[
                {
                  badge: <TeamBadge abbreviation={match.awayTeam.abbreviation} name={match.awayTeam.name} size={28} />,
                  label: match.awayTeam.name,
                },
                {
                  badge: <TeamBadge abbreviation={match.homeTeam.abbreviation} name={match.homeTeam.name} size={28} />,
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
    </div>
  );
}
