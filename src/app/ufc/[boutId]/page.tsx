import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getUfcBoutHeader, type UfcFighterBio } from "@/lib/queries/ufcEvents";
import { getUfcMatchup } from "@/lib/queries/ufcMatchup";
import { computeUfcWinProbability } from "@/lib/ufc/fighterMath";
import { BackLink } from "@/components/BackLink";
import { FighterBadge } from "@/components/FighterBadge";
import { UfcWinProbabilityCard, RED_CORNER, BLUE_CORNER } from "@/components/ufc/UfcWinProbabilityCard";
import { UfcFightHistory } from "@/components/ufc/UfcFightHistory";

export async function generateMetadata({ params }: { params: Promise<{ boutId: string }> }): Promise<Metadata> {
  const { boutId } = await params;
  const header = await getUfcBoutHeader(boutId);
  if (!header) return {};

  const title = `${header.red.name} vs ${header.blue.name}`;
  const description = `${title} (${header.weightClass}) — archer fighter-math win-probability projection.`;
  return { title, description, openGraph: { title, description }, twitter: { title, description } };
}

function formatEventDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(date);
}

function FighterColumn({ fighter, color }: { fighter: UfcFighterBio; color: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1.5 text-center">
      <FighterBadge name={fighter.name} imageUrl={fighter.imageUrl} color={color} size={44} />
      <span className="text-sm font-semibold text-foreground">{fighter.name}</span>
      {fighter.nickname ? <span className="text-xs italic text-muted-foreground">&ldquo;{fighter.nickname}&rdquo;</span> : null}
      {fighter.record ? <span className="font-mono text-xs text-muted-foreground">{fighter.record}</span> : null}
    </div>
  );
}

export default async function UfcBoutPage({ params }: { params: Promise<{ boutId: string }> }) {
  const { boutId } = await params;
  const [header, matchup] = await Promise.all([getUfcBoutHeader(boutId), getUfcMatchup(boutId)]);
  if (!header) notFound();

  const projection = matchup ? computeUfcWinProbability(matchup) : null;

  const winner =
    header.winnerFighterId === header.red.id
      ? header.red
      : header.winnerFighterId === header.blue.id
        ? header.blue
        : null;
  const loser = winner ? (winner.id === header.red.id ? header.blue : header.red) : null;

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <BackLink fallbackHref="/ufc" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
        ← Back
      </BackLink>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
          {header.weightClass}
        </span>
        {header.titleBout ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            Title bout
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {header.eventTitle} · {formatEventDate(header.eventDate)}
        {header.location ? ` · ${header.location}` : ""}
      </p>

      {/* Matchup band */}
      <div className="mt-4 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <FighterColumn fighter={header.red} color={RED_CORNER} />
          <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-muted-foreground">vs</span>
          <FighterColumn fighter={header.blue} color={BLUE_CORNER} />
        </div>

        {winner && loser ? (
          <p className="mt-4 border-t border-border pt-3 text-center text-sm text-foreground">
            <span className="font-semibold">{winner.name}</span>
            <span className="text-muted-foreground"> def. </span>
            <span>{loser.name}</span>
            {header.method ? <span className="text-muted-foreground"> · {header.method}</span> : null}
            {header.methodDetails ? <span className="text-muted-foreground"> ({header.methodDetails})</span> : null}
            {header.resultRound ? <span className="text-muted-foreground"> · R{header.resultRound}</span> : null}
            {header.resultTime ? <span className="text-muted-foreground"> {header.resultTime}</span> : null}
          </p>
        ) : header.method ? (
          <p className="mt-4 border-t border-border pt-3 text-center text-sm text-muted-foreground">
            {header.method}
            {header.resultRound ? ` · R${header.resultRound}` : ""}
          </p>
        ) : null}
      </div>

      {projection ? (
        <div className="mt-4">
          <UfcWinProbabilityCard redName={header.red.name} blueName={header.blue.name} projection={projection} />
        </div>
      ) : null}

      {matchup ? (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UfcFightHistory fighterName={header.red.name} fights={matchup.fighterA.fights} />
          <UfcFightHistory fighterName={header.blue.name} fights={matchup.fighterB.fights} />
        </div>
      ) : null}
    </div>
  );
}
