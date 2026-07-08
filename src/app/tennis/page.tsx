import { listTennisMatchesWithLines } from "@/lib/queries/tennisMatches";
import type { MatchSummary } from "@/lib/queries/tennisMatches";
import type { GameLineRow } from "@/lib/queries/games";
import { americanToDecimal, formatAmerican } from "@/lib/odds/americanOdds";
import { TennisPlayerBadge } from "@/components/TennisPlayerBadge";
import { MatchCard, type MatchCardChip } from "@/components/MatchCard";

// Unlike the MLB routes, this page has no searchParams/dynamic segment to
// signal Next.js that it needs per-request rendering — without this it gets
// statically prerendered at build time (confirmed: build tried to query the
// DB during CI and failed). Odds here update via cron, not deploys; a
// statically-cached build would show stale build-time prices until the next
// deploy, not the current polled data.
export const dynamic = "force-dynamic";

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(date);
}

/** Surname only — chip labels stay compact even for long two-part names. */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

/** Best (highest decimal-odds) price per side — moneyline only, tennis v1 has no other market. */
function bestPricePreview(match: MatchSummary, lines: GameLineRow[]): MatchCardChip[] {
  const bestBySide = new Map<string, GameLineRow>();
  for (const line of lines) {
    const current = bestBySide.get(line.side);
    if (!current || americanToDecimal(line.priceAmerican) > americanToDecimal(current.priceAmerican)) {
      bestBySide.set(line.side, line);
    }
  }

  return ["away", "home"]
    .map((side) => bestBySide.get(side))
    .filter((line): line is GameLineRow => line !== undefined)
    .map((line) => ({
      label: shortName(line.side === "home" ? match.homePlayer.name : match.awayPlayer.name),
      value: formatAmerican(line.priceAmerican),
    }));
}

export default async function TennisPage() {
  const matches = await listTennisMatchesWithLines();

  return (
    <div className="mx-auto min-h-screen w-full min-w-0 max-w-2xl px-4 py-10 font-sans">
      <h1 className="text-xl font-semibold text-foreground">Tennis</h1>
      <p className="text-sm text-muted-foreground">
        Tennis odds line-shopping — moneyline only, one tournament tracked at a time.
        Research/discovery only, no bet placement or tracking.
      </p>

      {matches.length === 0 ? (
        <p className="mt-6 py-10 text-center text-sm text-muted-foreground">
          No tennis matches tracked right now.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {matches.map(({ match, lines }) => (
            <MatchCard
              key={match.id}
              href={`/tennis/${match.id}`}
              competitors={[
                { badge: <TennisPlayerBadge name={match.awayPlayer.name} size={28} />, label: match.awayPlayer.name },
                { badge: <TennisPlayerBadge name={match.homePlayer.name} size={28} />, label: match.homePlayer.name },
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
