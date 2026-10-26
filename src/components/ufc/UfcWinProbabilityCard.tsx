import type { ProjectionConfidence, UfcMatchupProjection } from "@/lib/ufc/fighterMath";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

/** UFC corner colors — shared with the matchup header so the badge tint and the probability bar read as the same fighter. */
export const RED_CORNER = "#e11d48";
export const BLUE_CORNER = "#2563eb";

interface UfcWinProbabilityCardProps {
  redName: string;
  blueName: string;
  projection: UfcMatchupProjection;
}

const CONFIDENCE_TONE: Record<ProjectionConfidence, string> = {
  high: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  low: "bg-muted text-muted-foreground",
};

const CONFIDENCE_NOTE: Record<ProjectionConfidence, string> = {
  high: "Both fighters have several UFC fights behind this number.",
  medium: "At least one fighter has only a few UFC fights; their pro record carries part of the number.",
  low: "A UFC debut: that fighter's side rests on their pro record, read against what UFC signees typically bring in, with a discount for the step up. Treat it as a starting point.",
};

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** A factor's signed comparison (positive favors red / fighter A) rendered as a "favors NAME" chip. */
function FavorsChip({ value, redName, blueName }: { value: number; redName: string; blueName: string }) {
  if (Math.abs(value) < 0.02) {
    return <span className="text-xs font-medium text-muted-foreground">even</span>;
  }
  const favorsRed = value > 0;
  return (
    <span
      className="text-xs font-semibold"
      style={{ color: favorsRed ? RED_CORNER : BLUE_CORNER }}
    >
      {favorsRed ? redName : blueName}
    </span>
  );
}

interface FactorRowProps {
  label: string;
  hop?: 1 | 2;
  value: number;
  redName: string;
  blueName: string;
}

function FactorRow({ label, hop, value, redName, blueName }: FactorRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span className="truncate">{label}</span>
        {hop === 2 ? (
          <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            2-hop
          </span>
        ) : null}
      </span>
      <FavorsChip value={value} redName={redName} blueName={blueName} />
    </div>
  );
}

/**
 * Renders the "fighter math" projection — a probability bar plus the full
 * reasoning trail (form strength, shared opponents, style edges) that
 * produced it. Presentational only; the model runs in lib/ufc/fighterMath.ts.
 * Deliberately transparent, matching how the MLB Archer model surfaces its
 * inputs rather than showing a single opaque number.
 */
export function UfcWinProbabilityCard({ redName, blueName, projection }: UfcWinProbabilityCardProps) {
  const { fighterAProb, fighterBProb, fighterAStrength, fighterBStrength, commonOpponentAdjustment, styleAdjustment, confidence } =
    projection;

  if (fighterAProb === null || fighterBProb === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-foreground">Fighter-math projection</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Neither a UFC fight nor a pro record on file for one of these fighters yet, so there&apos;s nothing honest to
            project from.
          </p>
        </CardContent>
      </Card>
    );
  }

  const sharedOpponents = [...commonOpponentAdjustment.details].sort((a, b) => b.weight - a.weight).slice(0, 5);
  const styleEdges = styleAdjustment.details;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-sm font-semibold text-foreground">
          Fighter-math projection
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${CONFIDENCE_TONE[confidence]}`}
            title={CONFIDENCE_NOTE[confidence]}
          >
            {confidence} confidence
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {confidence === "low" && (
          <p className="mb-3 rounded-md bg-muted px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
            {CONFIDENCE_NOTE.low}
          </p>
        )}
        {/* Probability bar */}
        <div className="flex items-center justify-between text-sm font-semibold">
          <span style={{ color: RED_CORNER }}>{pct(fighterAProb)}</span>
          <span style={{ color: BLUE_CORNER }}>{pct(fighterBProb)}</span>
        </div>
        <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full">
          <div style={{ width: pct(fighterAProb), backgroundColor: RED_CORNER }} />
          <div style={{ width: pct(fighterBProb), backgroundColor: BLUE_CORNER }} />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
          <span className="truncate">{redName}</span>
          <span className="truncate text-right">{blueName}</span>
        </div>

        <Separator className="my-4" />

        {/* Form strength */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Career form strength</span>
          <span className="font-mono font-medium text-foreground">
            <span style={{ color: RED_CORNER }}>{fighterAStrength?.toFixed(2)}</span>
            {" · "}
            <span style={{ color: BLUE_CORNER }}>{fighterBStrength?.toFixed(2)}</span>
          </span>
        </div>

        {/* Shared opponents */}
        {sharedOpponents.length > 0 ? (
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Shared opponents</p>
            <div className="mt-1 divide-y divide-border/60">
              {sharedOpponents.map((d) => (
                <FactorRow key={d.label} label={d.label} hop={d.hopDistance} value={d.comparison} redName={redName} blueName={blueName} />
              ))}
            </div>
          </div>
        ) : null}

        {/* Style edges */}
        {styleEdges.length > 0 ? (
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Style edges</p>
            <div className="mt-1 divide-y divide-border/60">
              {styleEdges.map((d) => (
                <FactorRow key={d.label} label={d.label} value={d.comparison} redName={redName} blueName={blueName} />
              ))}
            </div>
          </div>
        ) : null}

        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
          A transparent model over each fighter&apos;s UFC career (decay-weighted result quality, shared opponents and
          stat-based style edges), starting from their pre-UFC pro record, and calibrated against past fights so a
          stated 60% has won about 60% of the time. Directional, not a guarantee.
        </p>
      </CardContent>
    </Card>
  );
}
