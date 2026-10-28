import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMatchWithLines } from "@/lib/queries/tennisMatches";
import { getPlayerHitRate } from "@/lib/queries/hitRate";
import { MatchLinesView } from "@/components/MatchLinesView";
import { TennisMatchBreakdown } from "@/components/matchup/TennisMatchBreakdown";
import { prisma } from "@/lib/prisma";
import { normalizeName } from "@/lib/tennis/archive";
import { BackLink } from "@/components/BackLink";

/** Shares getMatchWithLines's per-request cache() with the page component below — same pattern as the MLB game page. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ matchId: string }>;
}): Promise<Metadata> {
  const { matchId } = await params;
  const result = await getMatchWithLines(matchId);
  if (!result) return {};

  const { match } = result;
  const title = `${match.awayPlayer.name} vs ${match.homePlayer.name}`;
  const description = `${title} — tennis line-shopping and market EV.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { title, description },
  };
}

export default async function TennisMatchPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  const result = await getMatchWithLines(matchId);
  if (!result) notFound();

  const { match, lines } = result;
  const [homeHitRate, awayHitRate] = await Promise.all([
    getPlayerHitRate(match.homePlayer.id),
    getPlayerHitRate(match.awayPlayer.id),
  ]);

  const ratings = await prisma.tennisRating.findMany({
    where: { norm: { in: [normalizeName(match.awayPlayer.name), normalizeName(match.homePlayer.name)] } },
    select: { norm: true, overall: true, hard: true, clay: true, grass: true, nOverall: true },
    orderBy: { nOverall: "desc" },
  });
  const ratingOf = (name: string) => ratings.find((r) => r.norm === normalizeName(name)) ?? null;
  const when = `${new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(match.scheduledStartUtc)} ET`;

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-10 pt-5 font-sans">
      <BackLink fallbackHref="/sports/tennis" className="text-sm text-muted-foreground hover:text-foreground">
        ← Tennis
      </BackLink>
      <h1 className="sr-only">
        {match.awayPlayer.name} vs {match.homePlayer.name}
      </h1>
      <TennisMatchBreakdown match={match} lines={lines} away={ratingOf(match.awayPlayer.name)} home={ratingOf(match.homePlayer.name)} when={when} />

      <div className="mt-8">
        <MatchLinesView
          match={match}
          lines={lines}
          homeHitRate={homeHitRate}
          awayHitRate={awayHitRate}
        />
      </div>
    </div>
  );
}
