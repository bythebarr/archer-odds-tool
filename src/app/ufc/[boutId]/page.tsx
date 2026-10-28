import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getUfcBoutHeader } from "@/lib/queries/ufcEvents";
import { getUfcMatchup } from "@/lib/queries/ufcMatchup";
import { getUfcBoutOdds } from "@/lib/queries/ufcOdds";
import { CALIBRATION_SHRINK, STRENGTH_SENSITIVITY, computeUfcWinProbability } from "@/lib/ufc/fighterMath";
import { computeFinishProjection, scheduledRoundsForBout } from "@/lib/ufc/finishMath";
import { refreshUfcOddsOnView } from "@/lib/ufc/refreshOddsOnView";
import { BackLink } from "@/components/BackLink";
import { FighterBadge } from "@/components/FighterBadge";
import Link from "next/link";
import { UfcWinProbabilityCard, RED_CORNER, BLUE_CORNER } from "@/components/ufc/UfcWinProbabilityCard";
import { FaceOff, TaleOfTape, ValueStrip, WhyPanel, type Factor, type ValueRow } from "@/components/matchup/Matchup";
import { BOOK_NAMES } from "@/lib/odds/bookAllowlist";
import { calculateEv } from "@/lib/odds/devig";
import { blendWithMarket, DEFAULT_MODEL_WEIGHT } from "@/lib/propModel/market";
import { decimalToAmerican, formatAmerican } from "@/lib/odds/americanOdds";
import { FEATURE_LABEL } from "@/lib/ufc/fightModel";
import { UfcFinishProjectionCard } from "@/components/ufc/UfcFinishProjectionCard";
import { UfcFightHistory } from "@/components/ufc/UfcFightHistory";
import { UfcFightModelCard } from "@/components/ufc/UfcFightModelCard";
import { getUfcFightModel } from "@/lib/queries/ufcFightModel";
import { getUfcPropsSlate } from "@/lib/queries/ufcProps";
import { OpenFighterButton, UfcBoutProps } from "@/components/ufc/UfcPropsFinder";

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

const inchesEdge = (red: number | null, blue: number | null): "a" | "b" | null =>
  red === null || blue === null || Math.abs(red - blue) < 1 ? null : red > blue ? "a" : "b";
const logitPts = (x: number) => x * 25;
const ptsLabel = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)} pts`;
const fairAmerican = (p: number) => formatAmerican(Math.round(decimalToAmerican(1 / Math.min(0.995, Math.max(0.005, p)))));

export default async function UfcBoutPage({ params }: { params: Promise<{ boutId: string }> }) {
  const { boutId } = await params;
  // Read-side self-heal for the odds feed (Hobby crons fire unreliably) —
  // refreshes all UFC moneylines after the response when stale. See refreshUfcOddsOnView.
  refreshUfcOddsOnView();
  const [header, matchup, odds, fightModel, props] = await Promise.all([
    getUfcBoutHeader(boutId),
    getUfcMatchup(boutId),
    getUfcBoutOdds(boutId),
    getUfcFightModel(boutId),
    getUfcPropsSlate({ boutId }),
  ]);
  if (!header) notFound();

  const v1 = matchup ? computeUfcWinProbability(matchup) : null;
  // The fitted v2 model takes over the headline numbers only once its backtest beat v1 out of sample.
  const projection =
    v1 && fightModel?.beatsV1 ? { ...v1, fighterAProb: fightModel.probRed, fighterBProb: 1 - fightModel.probRed } : v1;
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

  // ARCHR vs the book: the side whose best price returns more at ARCHR's chance.
  const valueRows: ValueRow[] = [];
  if (projection?.fighterAProb != null && odds && (odds.red || odds.blue)) {
    // Edge on the same footing as every sport: the model blended with the books' no-vig line.
    // (The fitted fight model's chance already carries the blend.)
    const pRed = !fightModel?.beatsV1 && odds.marketFairProbRed !== null ? blendWithMarket(projection.fighterAProb, odds.marketFairProbRed, DEFAULT_MODEL_WEIGHT) : projection.fighterAProb;
    const evRed = odds.red ? calculateEv(pRed, odds.red.priceAmerican) : null;
    const evBlue = odds.blue ? calculateEv(1 - pRed, odds.blue.priceAmerican) : null;
    const red = evRed !== null || evBlue !== null ? (evRed ?? -Infinity) >= (evBlue ?? -Infinity) : pRed >= 0.5;
    const line = red ? odds.red : odds.blue;
    valueRows.push({
      market: "Moneyline",
      pick: (red ? header.red : header.blue).name,
      fair: fairAmerican(red ? pRed : 1 - pRed),
      best: line ? { priceAmerican: line.priceAmerican, bookKey: line.bookKey, bookName: BOOK_NAMES[line.bookKey] ?? line.bookKey } : null,
      edge: red ? evRed : evBlue,
    });
  }

  // Why: each input's push on the win chance, positive toward red.
  const factors: Factor[] = [];
  if (fightModel?.beatsV1) {
    for (const c of fightModel.contributions.slice(0, 7)) {
      const v = logitPts(c.logit);
      factors.push({ label: FEATURE_LABEL[c.feature], value: v, display: ptsLabel(v) });
    }
  } else if (v1 && v1.fighterAStrength !== null && v1.fighterBStrength !== null) {
    const parts = [
      { label: "Form & record", logit: (v1.fighterAStrength - v1.fighterBStrength) * STRENGTH_SENSITIVITY },
      { label: "Shared opponents", logit: v1.commonOpponentAdjustment.logitShift },
      { label: "Style matchup", logit: v1.styleAdjustment.logitShift },
    ];
    for (const p of parts) {
      const v = logitPts(p.logit * CALIBRATION_SHRINK);
      factors.push({ label: p.label, value: v, display: ptsLabel(v) });
    }
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-10 pt-5 font-sans">
      <BackLink fallbackHref="/ufc" className="text-sm text-muted-foreground hover:text-foreground">
        ← UFC
      </BackLink>

      <FaceOff
        a={{ name: header.red.name, sub: [header.red.nickname ? `“${header.red.nickname}”` : null, header.red.record].filter(Boolean).join(" · ") || null, badge: (
            <OpenFighterButton fighterId={header.red.id} label={header.red.name}>
              <FighterBadge name={header.red.name} imageUrl={header.red.imageUrl} size={88} />
            </OpenFighterButton>
          ), color: RED_CORNER }}
        b={{ name: header.blue.name, sub: [header.blue.nickname ? `“${header.blue.nickname}”` : null, header.blue.record].filter(Boolean).join(" · ") || null, badge: (
            <OpenFighterButton fighterId={header.blue.id} label={header.blue.name}>
              <FighterBadge name={header.blue.name} imageUrl={header.blue.imageUrl} size={88} />
            </OpenFighterButton>
          ), color: BLUE_CORNER }}
        probA={projection?.fighterAProb ?? null}
        probLabel={fightModel?.beatsV1 ? "ARCHR fight model win probability" : "ARCHR fighter-math win probability"}
        chips={
          <>
            {header.titleBout ? (
              <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[#07080b]">Title fight</span>
            ) : header.isMainEvent ? (
              <span className="rounded bg-[#c8f53a] px-1.5 py-0.5 text-[#07080b]">Main event</span>
            ) : null}
            <span className="text-[#8a90a0]">
              {header.weightClass} · {scheduledRounds} rounds
            </span>
          </>
        }
        meta={`${header.eventTitle} · ${formatEventDate(header.eventDate)}${header.location ? ` · ${header.location}` : ""}`}
        footer={
          winner && loser ? (
            <p>
              <span className="font-semibold">{winner.name}</span>
              <span className="text-[#8a90a0]"> def. </span>
              <span>{loser.name}</span>
              {header.method ? <span className="text-[#8a90a0]"> · {header.method}</span> : null}
              {header.methodDetails ? <span className="text-[#8a90a0]"> ({header.methodDetails})</span> : null}
              {header.resultRound ? <span className="text-[#8a90a0]"> · R{header.resultRound}</span> : null}
              {header.resultTime ? <span className="text-[#8a90a0]"> {header.resultTime}</span> : null}
            </p>
          ) : null
        }
      />

      {valueRows.length > 0 && (
        <ValueStrip
          rows={valueRows}
          footnote={
            <>
              ARCHR&apos;s chance (the model blended with the market) against the best moneyline at every book{odds?.marketFairProbRed != null ? ` (market no-vig: ${Math.round(odds.marketFairProbRed * 100)}% · ${Math.round((odds.marketFairProbBlue ?? 0) * 100)}% from ${odds.bookCount} books)` : ""}; edge is what that price returns at ARCHR&apos;s chance.{" "}
              <Link href="/models" className="font-semibold text-foreground underline-offset-2 hover:underline">
                How accurate is it?
              </Link>
            </>
          }
        />
      )}

      <TaleOfTape
        a={{ label: header.red.name.split(" ").at(-1)!, color: RED_CORNER }}
        b={{ label: header.blue.name.split(" ").at(-1)!, color: BLUE_CORNER }}
        rows={[
          { label: "Record", a: header.red.record ?? "—", b: header.blue.record ?? "—" },
          { label: "Height", a: heightLabel(header.red.heightInches), b: heightLabel(header.blue.heightInches), edge: inchesEdge(header.red.heightInches, header.blue.heightInches) },
          { label: "Reach", a: header.red.reachInches === null ? "—" : `${header.red.reachInches}"`, b: header.blue.reachInches === null ? "—" : `${header.blue.reachInches}"`, edge: inchesEdge(header.red.reachInches, header.blue.reachInches) },
          { label: "Stance", a: header.red.stance ?? "—", b: header.blue.stance ?? "—" },
          { label: "Division", a: header.red.division ?? "—", b: header.blue.division ?? "—" },
        ]}
      />

      <WhyPanel
        factors={factors}
        a={{ label: header.red.name.split(" ").at(-1)!, color: RED_CORNER }}
        b={{ label: header.blue.name.split(" ").at(-1)!, color: BLUE_CORNER }}
        footnote={fightModel?.beatsV1 ? "Each fighting stat's push on the fight model, in points of win chance (near even)." : "Form, shared opponents and style, each as its push in points of win chance (near even), after calibration."}
      />

      <UfcBoutProps slate={props} />

      {fightModel ? (
        <div className="mt-6">
          <UfcFightModelCard view={fightModel} redName={header.red.name} blueName={header.blue.name} />
        </div>
      ) : null}

      {v1 ? (
        <div className="mt-6">
          <UfcWinProbabilityCard redName={header.red.name} blueName={header.blue.name} projection={v1} />
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
