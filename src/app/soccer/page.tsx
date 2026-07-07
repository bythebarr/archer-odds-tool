import Link from "next/link";
import { listSoccerMatchesWithLines } from "@/lib/queries/soccerMatches";
import type { SoccerMatchSummary } from "@/lib/queries/soccerMatches";
import type { GameLineRow } from "@/lib/queries/games";
import { americanToDecimal, formatAmerican } from "@/lib/odds/americanOdds";
import { TeamBadge } from "@/components/TeamBadge";

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
function bestPricePreview(match: SoccerMatchSummary, lines: GameLineRow[]): string | null {
  const bestBySide = new Map<string, GameLineRow>();
  for (const line of lines) {
    const current = bestBySide.get(line.side);
    if (!current || americanToDecimal(line.priceAmerican) > americanToDecimal(current.priceAmerican)) {
      bestBySide.set(line.side, line);
    }
  }

  const parts = ["away", "draw", "home"]
    .map((side) => bestBySide.get(side))
    .filter((line): line is GameLineRow => line !== undefined)
    .map((line) => {
      const name = line.side === "home" ? match.homeTeam.name : line.side === "away" ? match.awayTeam.name : "Draw";
      return `${name} ${formatAmerican(line.priceAmerican)}`;
    });

  return parts.length > 0 ? parts.join("  ·  ") : null;
}

export default async function SoccerPage() {
  const matches = await listSoccerMatchesWithLines();

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <p className="text-sm text-muted-foreground">
        World Cup soccer odds line-shopping — moneyline (3-way) only, no Market EV yet.
        Research/discovery only, no bet placement or tracking.
      </p>

      <ul className="mt-6 divide-y divide-border">
        {matches.length === 0 && (
          <li className="py-6 text-center text-sm text-muted-foreground">
            No World Cup matches tracked right now.
          </li>
        )}
        {matches.map(({ match, lines }) => (
          <li key={match.id}>
            <Link
              href={`/soccer/${match.id}`}
              className="block py-4 hover:bg-accent/50"
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <TeamBadge abbreviation={match.awayTeam.abbreviation} name={match.awayTeam.name} size={20} />
                  {match.awayTeam.name} vs {match.homeTeam.name}
                  <TeamBadge abbreviation={match.homeTeam.abbreviation} name={match.homeTeam.name} size={20} />
                </span>
                <div className="flex flex-col items-end">
                  <span className="text-sm text-foreground">
                    {formatTime(match.scheduledStartUtc)} ET
                  </span>
                  <span className="text-xs uppercase text-muted-foreground">
                    {match.status}
                  </span>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {bestPricePreview(match, lines) ?? "No odds polled yet"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
