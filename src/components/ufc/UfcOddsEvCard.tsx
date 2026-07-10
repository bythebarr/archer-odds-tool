import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RED_CORNER, BLUE_CORNER } from "./UfcWinProbabilityCard";
import { americanToDecimal, decimalToAmerican, formatAmerican } from "@/lib/odds/americanOdds";
import { calculateEv } from "@/lib/odds/devig";
import type { UfcBoutOddsSummary, UfcCornerBestLine } from "@/lib/queries/ufcOdds";

interface UfcOddsEvCardProps {
  redName: string;
  blueName: string;
  /** Fighter-math win probabilities (0..1) — the page only renders this card when both are non-null. */
  redProb: number;
  blueProb: number;
  odds: UfcBoutOddsSummary;
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** Model probability → the fair American line it implies (fair decimal = 1/p). */
function fairAmerican(prob: number): number {
  return decimalToAmerican(1 / prob);
}

function CornerEvRow({
  name,
  color,
  prob,
  line,
}: {
  name: string;
  color: string;
  prob: number;
  line: UfcCornerBestLine | null;
}) {
  // EV as a fraction of stake if our model prob is the true win probability.
  const ev = line ? calculateEv(prob, line.priceAmerican) : null;
  const positive = ev !== null && ev > 0;

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate text-sm font-medium text-foreground">{name}</span>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs">
        <span className="text-muted-foreground">
          fair <span className="font-mono text-foreground">{formatAmerican(fairAmerican(prob))}</span>
        </span>
        {line ? (
          <>
            <span className="text-muted-foreground">
              best{" "}
              <span className="font-mono text-foreground">{formatAmerican(line.priceAmerican)}</span>{" "}
              <span className="text-[10px] uppercase tracking-wide">{line.bookKey}</span>
            </span>
            <span
              className="w-14 text-right font-mono font-semibold"
              style={{ color: positive ? "#16a34a" : undefined }}
            >
              {ev !== null ? `${ev > 0 ? "+" : ""}${(ev * 100).toFixed(1)}%` : "—"}
            </span>
          </>
        ) : (
          <span className="w-14 text-right text-muted-foreground">no line</span>
        )}
      </div>
    </div>
  );
}

/**
 * Pairs the fighter-math win probability with the live moneyline to surface
 * edge: our fair line vs. the best available book price, and the resulting EV%
 * (positive = the model sees value the market doesn't). Uses the same
 * calculateEv/devig math as the MLB board, with our model probability standing
 * in as the "fair" probability instead of the market consensus. Presentational
 * only — best-price and devig run in queries/ufcOdds.ts.
 */
export function UfcOddsEvCard({ redName, blueName, redProb, blueProb, odds }: UfcOddsEvCardProps) {
  const hasAnyLine = odds.red !== null || odds.blue !== null;
  if (!hasAnyLine) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-foreground">Moneyline value (fighter-math EV)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border/60">
          <CornerEvRow name={redName} color={RED_CORNER} prob={redProb} line={odds.red} />
          <CornerEvRow name={blueName} color={BLUE_CORNER} prob={blueProb} line={odds.blue} />
        </div>

        {odds.marketFairProbRed !== null && odds.marketFairProbBlue !== null ? (
          <>
            <Separator className="my-3" />
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Market consensus ({odds.bookCount} books, no-vig)</span>
              <span className="font-mono font-medium">
                <span style={{ color: RED_CORNER }}>{pct(odds.marketFairProbRed)}</span>
                {" · "}
                <span style={{ color: BLUE_CORNER }}>{pct(odds.marketFairProbBlue)}</span>
              </span>
            </div>
          </>
        ) : null}

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          EV compares the best book price to the fighter-math projection (treated as the true win probability). It is
          only as good as that hand-tuned model — directional research, not a betting guarantee.
        </p>
      </CardContent>
    </Card>
  );
}
