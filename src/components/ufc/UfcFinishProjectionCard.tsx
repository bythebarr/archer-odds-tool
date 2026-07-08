import type { FinishProjection } from "@/lib/ufc/finishMath";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RED_CORNER, BLUE_CORNER } from "./UfcWinProbabilityCard";

interface UfcFinishProjectionCardProps {
  redName: string;
  blueName: string;
  projection: FinishProjection;
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** Method accents — KO warm, submission indigo, decision neutral. Cosmetic; the % carries the info. */
const METHOD_META = {
  ko: { label: "KO / TKO", color: "#ea580c" },
  submission: { label: "Submission", color: "#7c3aed" },
  decision: { label: "Decision", color: "#64748b" },
} as const;

/** Corner color at a given alpha, for cell intensity shading. */
function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * A 2-row grid (one per fighter) × (R1…Rn + Dec) of win probabilities. Every
 * cell across both rows sums to ~1. Cell background tints in the fighter's
 * corner color, scaled to the biggest cell, so the likeliest ending pops.
 */
function RoundGrid({
  redName,
  blueName,
  scheduledRounds,
  rowA,
  rowB,
}: {
  redName: string;
  blueName: string;
  scheduledRounds: number;
  rowA: number[];
  rowB: number[];
}) {
  const maxCell = Math.max(...rowA, ...rowB, 1e-6);
  const cols = `minmax(4.5rem, 1fr) repeat(${scheduledRounds + 1}, 2.5rem)`;
  const headers = [...Array.from({ length: scheduledRounds }, (_, i) => `R${i + 1}`), "Dec"];

  const Row = ({ name, color, row }: { name: string; color: string; row: number[] }) => (
    <>
      <div className="flex items-center gap-1.5 truncate py-1 pr-1 text-xs">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate text-foreground">{name}</span>
      </div>
      {row.map((p, i) => (
        <div
          key={i}
          className="flex items-center justify-center rounded font-mono text-[11px] text-foreground"
          style={{ backgroundColor: tint(color, 0.1 + 0.55 * (p / maxCell)) }}
        >
          {Math.round(p * 100)}%
        </div>
      ))}
    </>
  );

  return (
    <div className="grid min-w-[18rem] gap-1" style={{ gridTemplateColumns: cols }}>
      <div />
      {headers.map((h) => (
        <div key={h} className="text-center text-[10px] font-semibold uppercase text-muted-foreground">
          {h}
        </div>
      ))}
      <Row name={redName} color={RED_CORNER} row={rowA} />
      <Row name={blueName} color={BLUE_CORNER} row={rowB} />
    </div>
  );
}

function MethodBar({ method, prob }: { method: keyof typeof METHOD_META; prob: number }) {
  const { label, color } = METHOD_META[method];
  return (
    <div className="py-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium text-foreground">{pct(prob)}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
        <div style={{ width: pct(prob), backgroundColor: color }} className="h-full" />
      </div>
    </div>
  );
}

/**
 * "Finish math" projection — how the bout ends (method + round), layered on the
 * win probability. Presentational only; the model is in lib/ufc/finishMath.ts.
 * Transparent by design, like the win-prob card it sits beside.
 */
export function UfcFinishProjectionCard({ redName, blueName, projection }: UfcFinishProjectionCardProps) {
  if (!projection.available) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-foreground">Finish projection</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Not enough fight history on file to project a finish yet.</p>
        </CardContent>
      </Card>
    );
  }

  const { method, byFighter, goesTheDistanceProb, perFighterRounds, scheduledRounds, expectedFinishRound } = projection;

  // Lead with the most likely METHOD (aggregate — matches the bars below), and
  // for a finish, name whichever fighter is likelier to score it.
  const topMethod = (["ko", "submission", "decision"] as const).reduce((best, k) =>
    method[k] > method[best] ? k : best
  );
  const finisher = byFighter.a[topMethod] >= byFighter.b[topMethod]
    ? { name: redName, color: RED_CORNER }
    : { name: blueName, color: BLUE_CORNER };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-foreground">Finish projection</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Headline call */}
        <p className="text-sm text-foreground">
          {topMethod === "decision" ? (
            <>
              Most likely to <span className="font-semibold">go the distance</span> ({pct(goesTheDistanceProb)}).
            </>
          ) : (
            <>
              Most likely finish:{" "}
              <span className="font-semibold" style={{ color: finisher.color }}>
                {finisher.name}
              </span>{" "}
              by {METHOD_META[topMethod].label} ({pct(method[topMethod])}).
            </>
          )}
        </p>

        {/* Method distribution */}
        <div className="mt-3">
          <MethodBar method="ko" prob={method.ko} />
          <MethodBar method="submission" prob={method.submission} />
          <MethodBar method="decision" prob={method.decision} />
        </div>

        <Separator className="my-4" />

        {/* Per-fighter, per-round finish grid — the deep view: who ends it, when */}
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>How it ends — by fighter &amp; round</span>
          <span className="normal-case">
            {expectedFinishRound !== null ? `Exp. finish R${Math.round(expectedFinishRound)}` : ""}
          </span>
        </div>
        <div className="mt-2 overflow-x-auto">
          <RoundGrid
            redName={redName}
            blueName={blueName}
            scheduledRounds={scheduledRounds}
            rowA={[...perFighterRounds.a, byFighter.a.decision]}
            rowB={[...perFighterRounds.b, byFighter.b.decision]}
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Each cell = chance that fighter wins in that round; the <span className="font-medium text-foreground">Dec</span>{" "}
          column is a decision win. Goes the distance:{" "}
          <span className="font-medium text-foreground">{pct(goesTheDistanceProb)}</span>.
        </p>

        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
          Offense × durability over each fighter&apos;s decay-weighted career (how they finish vs. how they get
          finished), shrunk toward UFC base rates for thin records and conditioned on the win probability above —
          directional, not a backtested betting model.
        </p>
      </CardContent>
    </Card>
  );
}
