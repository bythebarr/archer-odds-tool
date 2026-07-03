import Link from "next/link";
import { listTennisMatchesWithLines } from "@/lib/queries/tennisMatches";
import type { MatchSummary } from "@/lib/queries/tennisMatches";
import type { GameLineRow } from "@/lib/queries/games";
import { americanToDecimal, formatAmerican } from "@/lib/odds/americanOdds";
import { PlayerBadge } from "@/components/PlayerBadge";

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

/** Best (highest decimal-odds) price per side — moneyline only, tennis v1 has no other market. */
function bestPricePreview(match: MatchSummary, lines: GameLineRow[]): string | null {
  const bestBySide = new Map<string, GameLineRow>();
  for (const line of lines) {
    const current = bestBySide.get(line.side);
    if (!current || americanToDecimal(line.priceAmerican) > americanToDecimal(current.priceAmerican)) {
      bestBySide.set(line.side, line);
    }
  }

  const parts = ["away", "home"]
    .map((side) => bestBySide.get(side))
    .filter((line): line is GameLineRow => line !== undefined)
    .map((line) => {
      const name = line.side === "home" ? match.homePlayer.name : match.awayPlayer.name;
      return `${name} ${formatAmerican(line.priceAmerican)}`;
    });

  return parts.length > 0 ? parts.join("  ·  ") : null;
}

export default async function TennisPage() {
  const matches = await listTennisMatchesWithLines();

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Tennis odds line-shopping — moneyline only, one tournament tracked at a time.
        Research/discovery only, no bet placement or tracking.
      </p>

      <ul className="mt-6 divide-y divide-zinc-200 dark:divide-zinc-800">
        {matches.length === 0 && (
          <li className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No tennis matches tracked right now.
          </li>
        )}
        {matches.map(({ match, lines }) => (
          <li key={match.id}>
            <Link
              href={`/tennis/${match.id}`}
              className="block py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium text-zinc-900 dark:text-zinc-50">
                  <PlayerBadge name={match.awayPlayer.name} />
                  {match.awayPlayer.name} vs {match.homePlayer.name}
                  <PlayerBadge name={match.homePlayer.name} />
                </span>
                <div className="flex flex-col items-end">
                  <span className="text-sm text-zinc-900 dark:text-zinc-50">
                    {formatTime(match.scheduledStartUtc)} ET
                  </span>
                  <span className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
                    {match.status}
                  </span>
                </div>
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {bestPricePreview(match, lines) ?? "No odds polled yet"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
