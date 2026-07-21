import type { Metadata } from "next";
import { listTennisMatchesWithLines } from "@/lib/queries/tennisMatches";
import type { MatchSummary } from "@/lib/queries/tennisMatches";
import type { GameLineRow } from "@/lib/queries/games";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { bestLinesBySide } from "@/lib/odds/bestPrice";
import { TennisPlayerBadge } from "@/components/TennisPlayerBadge";
import { MatchCard, type MatchCardChip } from "@/components/MatchCard";
import { PageShell, PageHeader } from "@/components/PageShell";
import { EmptyState } from "@/components/EmptyState";
import { getFeedFreshness } from "@/lib/freshness";

// Unlike the MLB routes, this page has no searchParams/dynamic segment to
// signal Next.js that it needs per-request rendering — without this it gets
// statically prerendered at build time (confirmed: build tried to query the
// DB during CI and failed). Odds here update via cron, not deploys; a
// statically-cached build would show stale build-time prices until the next
// deploy, not the current polled data.
export const metadata: Metadata = {
  title: "Tennis — moneyline line-shopping",
  description:
    "Moneyline odds line-shopping for the tracked tennis tournament — the best price across books, one match at a time.",
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

/** Surname only — chip labels stay compact even for long two-part names. */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

/** Best (highest decimal-odds) price per side — moneyline only, tennis v1 has no other market. */
function bestPricePreview(match: MatchSummary, lines: GameLineRow[]): MatchCardChip[] {
  return bestLinesBySide(lines, ["away", "home"]).map((line) => ({
    label: shortName(line.side === "home" ? match.homePlayer.name : match.awayPlayer.name),
    value: formatAmerican(line.priceAmerican),
  }));
}

export default async function TennisPage() {
  const [matches, freshness] = await Promise.all([listTennisMatchesWithLines(), getFeedFreshness("tennisOdds")]);

  return (
    <PageShell width="2xl">
      <PageHeader
        title="Tennis"
        description={
          <>
            Odds line-shopping — moneyline only, one tournament tracked at a time.{" "}
            {/* The old "prices only, nothing settles" caveat is gone: ESPN's free
                scoreboard settles matches now, so tennis is tracked like MLB.
                See SportMeta.signalOnly and src/lib/tennis/results.ts. */}
            <span className="text-muted-foreground/80">
              Results come from ESPN&apos;s public scoreboard, so tennis plays grade
              and count in the tracked record.
            </span>
          </>
        }
      />

      {matches.length === 0 ? (
        <EmptyState title="No tennis matches tracked right now" freshness={freshness} arrow="miss" supportContext="tennis-empty">
          Tennis coverage follows one tournament at a time — between events, there&apos;s nothing to price.
        </EmptyState>
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
    </PageShell>
  );
}
