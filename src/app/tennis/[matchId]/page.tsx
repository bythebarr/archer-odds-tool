import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMatchWithLines } from "@/lib/queries/tennisMatches";
import { getPlayerHitRate } from "@/lib/queries/hitRate";
import { MatchLinesView } from "@/components/MatchLinesView";
import { TennisPlayerBadge } from "@/components/TennisPlayerBadge";
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

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <BackLink fallbackHref="/tennis" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
        ← Back
      </BackLink>

      <h1 className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-semibold text-foreground">
        <span className="inline-flex items-center gap-2">
          <TennisPlayerBadge name={match.awayPlayer.name} size={24} />
          {match.awayPlayer.name}
        </span>
        <span>vs</span>
        <span className="inline-flex items-center gap-2">
          <TennisPlayerBadge name={match.homePlayer.name} size={24} />
          {match.homePlayer.name}
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
        }).format(match.scheduledStartUtc)}{" "}
        ET · {match.status}
      </p>

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
