import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSoccerMatchWithLines } from "@/lib/queries/soccerMatches";
import { SoccerMatchLinesView } from "@/components/SoccerMatchLinesView";
import { TeamBadge } from "@/components/TeamBadge";
import { BackLink } from "@/components/BackLink";

/** Shares getSoccerMatchWithLines's per-request cache() with the page component below — same pattern as the MLB/tennis game pages. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ matchId: string }>;
}): Promise<Metadata> {
  const { matchId } = await params;
  const result = await getSoccerMatchWithLines(matchId);
  if (!result) return {};

  const { match } = result;
  const title = `${match.awayTeam.name} vs ${match.homeTeam.name}`;
  const description = `${title} — World Cup line-shopping.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { title, description },
  };
}

export default async function SoccerMatchPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  const result = await getSoccerMatchWithLines(matchId);
  if (!result) notFound();

  const { match, lines } = result;

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <BackLink fallbackHref="/soccer" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
        ← Back
      </BackLink>

      <h1 className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-semibold text-foreground">
        <span className="inline-flex items-center gap-2">
          <TeamBadge abbreviation={match.awayTeam.abbreviation} name={match.awayTeam.name} size={24} />
          {match.awayTeam.name}
        </span>
        <span>vs</span>
        <span className="inline-flex items-center gap-2">
          <TeamBadge abbreviation={match.homeTeam.abbreviation} name={match.homeTeam.name} size={24} />
          {match.homeTeam.name}
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
        <SoccerMatchLinesView match={match} lines={lines} />
      </div>
    </div>
  );
}
