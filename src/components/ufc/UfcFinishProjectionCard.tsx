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

  const { method, byFighter, goesTheDistanceProb, rounds, expectedFinishRound } = projection;

  // Lead with the most likely METHOD (aggregate — matches the bars below), and
  // for a finish, name whichever fighter is likelier to score it.
  const topMethod = (["ko", "submission", "decision"] as const).reduce((best, k) =>
    method[k] > method[best] ? k : best
  );
  const finisher = byFighter.a[topMethod] >= byFighter.b[topMethod]
    ? { name: redName, color: RED_CORNER }
    : { name: blueName, color: BLUE_CORNER };

  const maxRound = Math.max(...rounds);

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

        {/* Round distribution */}
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>When it ends</span>
          <span className="normal-case">
            {expectedFinishRound !== null ? `Exp. finish R${Math.round(expectedFinishRound)}` : ""}
          </span>
        </div>
        <div className="mt-2 flex items-end gap-1.5">
          {rounds.map((p, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <span className="font-mono text-[11px] text-foreground">{pct(p)}</span>
              <div className="flex h-16 w-full items-end rounded bg-muted/60">
                <div
                  className="w-full rounded bg-foreground/80"
                  style={{ height: maxRound > 0 ? `${Math.max((p / maxRound) * 100, 3)}%` : "3%" }}
                />
              </div>
              <span className="text-[11px] text-muted-foreground">R{i + 1}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Goes the distance: <span className="font-medium text-foreground">{pct(goesTheDistanceProb)}</span>
          <span className="text-muted-foreground/70">
            {" "}
            · the final round includes a decision ending
          </span>
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
