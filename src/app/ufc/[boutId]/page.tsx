import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getUfcBoutHeader, type UfcFighterBio } from "@/lib/queries/ufcEvents";
import { getUfcMatchup } from "@/lib/queries/ufcMatchup";
import { getUfcBoutOdds } from "@/lib/queries/ufcOdds";
import { computeUfcWinProbability } from "@/lib/ufc/fighterMath";
import { computeFinishProjection, scheduledRoundsForBout } from "@/lib/ufc/finishMath";
import { refreshUfcOddsOnView } from "@/lib/ufc/refreshOddsOnView";
import { BackLink } from "@/components/BackLink";
import { FighterBadge } from "@/components/FighterBadge";
import { UfcWinProbabilityCard, RED_CORNER, BLUE_CORNER } from "@/components/ufc/UfcWinProbabilityCard";
import { UfcOddsEvCard } from "@/components/ufc/UfcOddsEvCard";
import { UfcFinishProjectionCard } from "@/components/ufc/UfcFinishProjectionCard";
import { UfcFightHistory } from "@/components/ufc/UfcFightHistory";

// Odds refresh after the response (see refreshUfcOddsOnView) needs a live
// request, and the moneyline should reflect current lines — render per request.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ boutId: string }> }): Promise<Metadata> {
  const { boutId } = await params;
  const header = await getUfcBoutHeader(boutId);
  if (!header) return {};

  const title = `${header.red.name} vs ${header.blue.name}`;
  const description = `${title} (${header.weightClass}) — Archer fighter-math win-probability projection.`;
  return { title, description, openGraph: { title, description }, twitter: { title, description } };
}

// eventDate is a Cito date-only value stored at UTC midnight — format in UTC so
// it doesn't roll back to the previous evening in ET ("Jul 11" → "Jul 10").
function formatEventDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function heightLabel(inches: number | null): string {
  if (inches === null) return "—";
  return `${Math.floor(inches / 12)}'${Math.round(inches % 12)}"`;
}

/** One tale-of-the-tape row: red's value, the label, blue's value — the bigger number bolded when it's an edge. */
function TapeRow({
  label,
  red,
  blue,
  edge,
}: {
  label: string;
  red: string;
  blue: string;
  /** Which side the comparison favors, when it's a measurable edge. */
  edge?: "red" | "blue" | null;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2.5 text-sm">
      <span className={`text-left font-mono ${edge === "red" ? "font-bold text-foreground" : "text-foreground/80"}`}>{red}</span>
      <span className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`text-right font-mono ${edge === "blue" ? "font-bold text-foreground" : "text-foreground/80"}`}>{blue}</span>
    </div>
  );
}

function edgeOf(red: number | null, blue: number | null, minGap: number): "red" | "blue" | null {
  if (red === null || blue === null || Math.abs(red - blue) < minGap) return null;
  return red > blue ? "red" : "blue";
}

function FaceOffCorner({ fighter, color, prob }: { fighter: UfcFighterBio; color: string; prob: number | null }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
      <span className="rounded-full p-[3px]" style={{ background: color }}>
        <FighterBadge name={fighter.name} imageUrl={fighter.imageUrl} size={88} />
      </span>
      <span className="mt-1 w-full truncate text-[15px] font-semibold">{fighter.name}</span>
      {fighter.nickname ? <span className="w-full truncate text-[11px] italic text-[#8a90a0]">&ldquo;{fighter.nickname}&rdquo;</span> : null}
      <span className="font-mono text-xs text-[#8a90a0]">{fighter.record ?? ""}</span>
      {prob !== null && <span className="mt-1 font-display text-2xl font-extrabold italic leading-none">{Math.round(prob * 100)}%</span>}
    </div>
  );
}

export default async function UfcBoutPage({ params }: { params: Promise<{ boutId: string }> }) {
  const { boutId } = await params;
  // Read-side self-heal for the odds feed (Hobby crons fire unreliably) —
  // refreshes all UFC moneylines after the response when stale. See refreshUfcOddsOnView.
  refreshUfcOddsOnView();
  const [header, matchup, odds] = await Promise.all([
    getUfcBoutHeader(boutId),
    getUfcMatchup(boutId),
    getUfcBoutOdds(boutId),
  ]);
  if (!header) notFound();

  const projection = matchup ? computeUfcWinProbability(matchup) : null;
  // 5 rounds for title fights AND main events (every UFC headliner goes 5,
  // belt or not), 3 otherwise — see scheduledRoundsForBout.
  const scheduledRounds = scheduledRoundsForBout(header);
  const finishProjection =
    matchup && projection ? computeFinishProjection(matchup, projection.fighterAProb, scheduledRounds) : null;

  const winner =
    header.winnerFighterId === header.red.id
      ? header.red
      : header.winnerFighterId === header.blue.id
        ? header.blue
        : null;
  const loser = winner ? (winner.id === header.red.id ? header.blue : header.red) : null;

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-10 pt-5 font-sans">
      <BackLink fallbackHref="/ufc" className="text-sm text-muted-foreground hover:text-foreground">
        ← UFC
      </BackLink>

      {/* Face-off: always ink, the two corners squared up over their win odds. */}
      <div className="relative mt-3 overflow-hidden rounded-2xl bg-[#07080b] bg-[radial-gradient(110%_90%_at_50%_120%,rgba(200,245,58,0.14),transparent_60%)] px-4 pb-5 pt-4 text-[#eef0f4] ring-1 ring-white/10">
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
          {header.titleBout ? (
            <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[#07080b]">Title fight</span>
          ) : header.isMainEvent ? (
            <span className="rounded bg-[#c8f53a] px-1.5 py-0.5 text-[#07080b]">Main event</span>
          ) : null}
          <span className="text-[#8a90a0]">
            {header.weightClass} · {scheduledRounds} rounds
          </span>
        </div>
        <p className="mt-1 text-center text-[11px] text-[#8a90a0]">
          {header.eventTitle} · {formatEventDate(header.eventDate)}
          {header.location ? ` · ${header.location}` : ""}
        </p>
        <div className="mt-4 flex items-start justify-between gap-2">
          <FaceOffCorner fighter={header.red} color={RED_CORNER} prob={projection?.fighterAProb ?? null} />
          <span className="mt-9 shrink-0 font-display text-xl font-extrabold italic text-[#c8f53a]">VS</span>
          <FaceOffCorner fighter={header.blue} color={BLUE_CORNER} prob={projection?.fighterBProb ?? null} />
        </div>
        {projection?.fighterAProb != null && (
          <div className="mt-3">
            <div className="flex h-1.5 overflow-hidden rounded-full" aria-hidden>
              <span style={{ width: `${projection.fighterAProb * 100}%`, background: RED_CORNER }} />
              <span className="flex-1" style={{ background: BLUE_CORNER }} />
            </div>
            <p className="mt-1.5 text-center text-[10px] uppercase tracking-wide text-[#8a90a0]">ARCHR fighter-math win probability</p>
          </div>
        )}
        {winner && loser ? (
          <p className="mt-4 border-t border-white/10 pt-3 text-center text-sm">
            <span className="font-semibold">{winner.name}</span>
            <span className="text-[#8a90a0]"> def. </span>
            <span>{loser.name}</span>
            {header.method ? <span className="text-[#8a90a0]"> · {header.method}</span> : null}
            {header.methodDetails ? <span className="text-[#8a90a0]"> ({header.methodDetails})</span> : null}
            {header.resultRound ? <span className="text-[#8a90a0]"> · R{header.resultRound}</span> : null}
            {header.resultTime ? <span className="text-[#8a90a0]"> {header.resultTime}</span> : null}
          </p>
        ) : null}
      </div>

      <section className="mt-6">
        <h2 className="mb-1 flex items-center gap-2 font-display text-sm font-extrabold uppercase italic tracking-wide text-foreground">
          <span className="brand-slash" aria-hidden />
          Tale of the tape
        </h2>
        <div className="divide-y divide-border rounded-xl border border-border bg-card px-3.5">
          <TapeRow label="Record" red={header.red.record ?? "—"} blue={header.blue.record ?? "—"} />
          <TapeRow
            label="Height"
            red={heightLabel(header.red.heightInches)}
            blue={heightLabel(header.blue.heightInches)}
            edge={edgeOf(header.red.heightInches, header.blue.heightInches, 1)}
          />
          <TapeRow
            label="Reach"
            red={header.red.reachInches === null ? "—" : `${header.red.reachInches}"`}
            blue={header.blue.reachInches === null ? "—" : `${header.blue.reachInches}"`}
            edge={edgeOf(header.red.reachInches, header.blue.reachInches, 1)}
          />
          <TapeRow label="Stance" red={header.red.stance ?? "—"} blue={header.blue.stance ?? "—"} />
          <TapeRow label="Division" red={header.red.division ?? "—"} blue={header.blue.division ?? "—"} />
        </div>
      </section>

      {projection ? (
        <div className="mt-6">
          <UfcWinProbabilityCard redName={header.red.name} blueName={header.blue.name} projection={projection} />
        </div>
      ) : null}

      {projection && projection.fighterAProb !== null && projection.fighterBProb !== null && odds ? (
        <div className="mt-4">
          <UfcOddsEvCard
            redName={header.red.name}
            blueName={header.blue.name}
            redProb={projection.fighterAProb}
            blueProb={projection.fighterBProb}
            odds={odds}
          />
        </div>
      ) : null}

      {finishProjection ? (
        <div className="mt-4">
          <UfcFinishProjectionCard redName={header.red.name} blueName={header.blue.name} projection={finishProjection} />
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
