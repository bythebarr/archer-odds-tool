import type { UfcMatchupProjection } from "@/lib/ufc/fighterMath";
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
  const { fighterAProb, fighterBProb, fighterAStrength, fighterBStrength, commonOpponentAdjustment, styleAdjustment } =
    projection;

  if (fighterAProb === null || fighterBProb === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-foreground">Fighter-math projection</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Not enough fight history on file to project this matchup yet.
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
        <CardTitle className="text-sm font-semibold text-foreground">Fighter-math projection</CardTitle>
      </CardHeader>
      <CardContent>
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
          A transparent, hand-tuned heuristic over each fighter&apos;s career (decay-weighted result quality, shared
          opponents, and stat-based style edges) — directional, not a rigorous or backtested betting model, and not a
          pre-fight market line.
        </p>
      </CardContent>
    </Card>
  );
}
