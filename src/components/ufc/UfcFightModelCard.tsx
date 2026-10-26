import Link from "next/link";
import type { UfcFightModelView } from "@/lib/queries/ufcFightModel";
import { FEATURE_LABEL, type FighterProfile } from "@/lib/ufc/fightModel";
import { RED_CORNER, BLUE_CORNER } from "./UfcWinProbabilityCard";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Stat rows: label, how to read it, and which way is better. */
const STAT_ROWS: { label: string; get: (p: FighterProfile) => number | null; fmt: (v: number) => string; higherBetter: boolean }[] = [
  { label: "Rating (Elo)", get: (p) => p.elo, fmt: (v) => v.toFixed(0), higherBetter: true },
  { label: "Sig. strikes landed / min", get: (p) => p.slpm, fmt: (v) => v.toFixed(2), higherBetter: true },
  { label: "Sig. strikes absorbed / min", get: (p) => p.sapm, fmt: (v) => v.toFixed(2), higherBetter: false },
  { label: "Strike defense", get: (p) => p.strikeDefense, fmt: pct, higherBetter: true },
  { label: "Takedowns / 15 min", get: (p) => p.td15, fmt: (v) => v.toFixed(2), higherBetter: true },
  { label: "Takedown defense", get: (p) => p.takedownDefense, fmt: pct, higherBetter: true },
  { label: "Knockdowns / 15 min", get: (p) => p.kd15, fmt: (v) => v.toFixed(2), higherBetter: true },
  { label: "Control time share", get: (p) => p.control, fmt: pct, higherBetter: true },
  { label: "UFC fights", get: (p) => p.fights, fmt: (v) => v.toFixed(0), higherBetter: true },
];

/**
 * ARCHR's fitted fight model (v2): the model alone, the market, and the blend;
 * what pushed it (each feature's logit, red to the left, blue to the right);
 * and the per-minute numbers underneath.
 */
export function UfcFightModelCard({ view, redName, blueName }: { view: UfcFightModelView; redName: string; blueName: string }) {
  const maxPush = Math.max(0.05, ...view.contributions.map((c) => Math.abs(c.logit)));
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 font-display text-sm font-extrabold uppercase italic tracking-wide text-foreground">
        <span className="brand-slash" aria-hidden />
        ARCHR fight model
      </h2>
      <div className="rounded-xl border border-border bg-card p-3.5">
        <div className="grid grid-cols-3 gap-1.5 text-center">
          {[
            { label: "Model", red: view.modelProbRed },
            { label: view.market ? `Market · ${view.market.books} books` : "Market", red: view.market?.probOver ?? null },
            { label: "ARCHR", red: view.probRed, strong: true },
          ].map((c) => (
            <div key={c.label} className={`rounded-lg px-2 py-1.5 ${c.strong ? "bg-brand/15 ring-1 ring-brand/40" : "bg-muted/60"}`}>
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{c.label}</p>
              <p className="font-mono text-sm font-semibold text-foreground">
                {c.red === null ? "—" : (
                  <>
                    <span style={{ color: RED_CORNER }}>{pct(c.red)}</span> · <span style={{ color: BLUE_CORNER }}>{pct(1 - c.red)}</span>
                  </>
                )}
              </p>
            </div>
          ))}
        </div>

        {view.contributions.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-[10px] font-semibold uppercase tracking-wide">
              <span style={{ color: RED_CORNER }}>Favors {redName.split(" ").at(-1)}</span>
              <span style={{ color: BLUE_CORNER }}>Favors {blueName.split(" ").at(-1)}</span>
            </div>
            <ul className="space-y-1">
              {view.contributions.slice(0, 7).map((c) => {
                const w = `${(Math.abs(c.logit) / maxPush) * 50}%`;
                return (
                  <li key={c.feature} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[11px]">
                    <div className="flex justify-end">{c.logit > 0 && <span className="h-2 rounded-l-full" style={{ width: w, background: RED_CORNER }} />}</div>
                    <span className="w-36 text-center text-muted-foreground">{FEATURE_LABEL[c.feature]}</span>
                    <div>{c.logit < 0 && <span className="block h-2 rounded-r-full" style={{ width: w, background: BLUE_CORNER }} />}</div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mt-3 divide-y divide-border rounded-lg border border-border">
          {STAT_ROWS.map((row) => {
            const r = row.get(view.red);
            const b = row.get(view.blue);
            const redBetter = r !== null && b !== null && (row.higherBetter ? r > b : r < b);
            const blueBetter = r !== null && b !== null && (row.higherBetter ? b > r : b < r);
            return (
              <div key={row.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-2.5 py-1.5 text-xs">
                <span className={`font-mono ${redBetter ? "font-bold text-foreground" : "text-muted-foreground"}`}>{r === null ? "—" : row.fmt(r)}</span>
                <span className="text-center text-[10px] uppercase tracking-wide text-muted-foreground">{row.label}</span>
                <span className={`text-right font-mono ${blueBetter ? "font-bold text-foreground" : "text-muted-foreground"}`}>{b === null ? "—" : row.fmt(b)}</span>
              </div>
            );
          })}
        </div>

        <p className="mt-2.5 text-[10px] leading-relaxed text-muted-foreground">
          An opponent-adjusted rating plus per-minute fighting stats (recency-weighted, steadied toward the league for short careers), reach,
          experience, layoff and weight moves —{" "}
          {view.coefficientsFitted ? "weighted by a regression fitted on every past UFC fight" : "weighted by research priors until the backtest fits them"}
          , then blended with the moneyline market ({pct(view.modelWeight)} model
          {view.weightFitted ? ", fitted on closing lines" : ", default until fitted"}).{" "}
          <Link href="/models" className="font-semibold text-foreground underline-offset-2 hover:underline">
            How accurate is it?
          </Link>
        </p>
      </div>
    </section>
  );
}
