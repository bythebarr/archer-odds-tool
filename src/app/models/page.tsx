import type { Metadata } from "next";
import { getModelCards, type ModelCard } from "@/lib/queries/modelReports";
import { ArchrMark } from "@/components/brand/ArchrMark";

export const metadata: Metadata = {
  title: "Model report card — how accurate is every ARCHR model",
  description: "Every ARCHR model graded against history: calibration, accuracy against a simple baseline, and whether it has earned trust.",
};

export const dynamic = "force-dynamic";

const VERDICT: Record<string, { label: string; tone: string; note: string }> = {
  trusted: { label: "Trusted", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", note: "Beats the no-skill baseline by a real margin." },
  marginal: { label: "Marginal", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300", note: "Close to coin-flip skill: honest, but no clear edge yet." },
  unproven: { label: "Unproven", tone: "bg-red-500/15 text-red-700 dark:text-red-300", note: "Not beating the baseline yet." },
  thin: { label: "Thin sample", tone: "bg-muted text-muted-foreground", note: "Not enough history to grade." },
};

const SPORT_ORDER = ["nba", "nfl", "ufc", "mlb", "tennis", "soccer", "f1"];
const sportOf = (model: string) => model.split(/[-:]/)[0];
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Predicted vs actual per probability bucket: the bars should sit on the diagonal. */
function Calibration({ buckets }: { buckets: ModelCard["buckets"] }) {
  const shown = buckets.filter((b) => b.n >= 10);
  if (shown.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Said vs happened</p>
      <div className="space-y-1">
        {shown.map((b) => (
          <div key={b.lo} className="grid grid-cols-[3.25rem_1fr_3rem] items-center gap-2 text-[11px]">
            <span className="font-mono text-muted-foreground">{pct(b.meanPred)}</span>
            <div className="relative h-2 rounded-full bg-muted">
              <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/25" style={{ width: pct(b.meanPred) }} />
              <span
                className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background ${Math.abs(b.gap) <= 0.04 ? "bg-emerald-500" : "bg-amber-500"}`}
                style={{ left: pct(b.actual) }}
              />
            </div>
            <span className="text-right font-mono text-foreground">{pct(b.actual)}</span>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">Bar = what the model said · dot = how often it happened ({buckets.reduce((a, b) => a + b.n, 0)} samples)</p>
    </div>
  );
}

function Card({ c }: { c: ModelCard }) {
  const v = VERDICT[c.verdict] ?? VERDICT.thin;
  const skill = c.baseRateBrier - c.brier; // positive = better than no-skill
  const trend = c.previousBrier === null ? null : c.previousBrier - c.brier;
  const maeGain = c.projectionMae !== null && c.baselineMae ? 1 - c.projectionMae / c.baselineMae : null;
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{c.label}</p>
          <p className="text-[11px] text-muted-foreground">
            {c.n.toLocaleString()} {c.unit}s · graded {c.runAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </p>
        </div>
        <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${v.tone}`} title={v.note}>
          {v.label}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded-lg bg-muted/60 px-1 py-1.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Skill vs coin flip</p>
          <p className={`font-mono text-sm font-semibold ${skill > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
            {skill >= 0 ? "+" : ""}
            {(skill * 1000).toFixed(1)}
          </p>
        </div>
        <div className="rounded-lg bg-muted/60 px-1 py-1.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Said / hit</p>
          <p className="font-mono text-sm font-semibold text-foreground">
            {pct(c.meanPred)} / {pct(c.actual)}
          </p>
        </div>
        <div className="rounded-lg bg-muted/60 px-1 py-1.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{maeGain !== null ? `vs ${c.baseline}` : "Since last run"}</p>
          <p className="font-mono text-sm font-semibold text-foreground">
            {maeGain !== null
              ? `${maeGain >= 0 ? "+" : ""}${(maeGain * 100).toFixed(1)}%`
              : trend === null
                ? "—"
                : `${trend >= 0 ? "▲" : "▼"} ${Math.abs(trend * 1000).toFixed(1)}`}
          </p>
        </div>
      </div>
      <Calibration buckets={c.buckets} />
    </div>
  );
}

/**
 * Every ARCHR model's report card, from the latest Model lab run: graded on
 * games it had never seen, with nothing from after the game leaking in.
 */
export default async function ModelsPage() {
  const cards = await getModelCards();
  const bySport = new Map<string, ModelCard[]>();
  for (const c of cards) bySport.set(sportOf(c.model), [...(bySport.get(sportOf(c.model)) ?? []), c]);
  const sports = [...bySport.keys()].sort((a, b) => (SPORT_ORDER.indexOf(a) + 1 || 99) - (SPORT_ORDER.indexOf(b) + 1 || 99));
  const counts = Object.fromEntries(Object.keys(VERDICT).map((k) => [k, cards.filter((c) => c.verdict === k).length]));

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-10 pt-5 font-sans">
      <div className="relative overflow-hidden rounded-2xl bg-[#07080b] px-5 py-5 text-[#eef0f4] ring-1 ring-white/10">
        <ArchrMark className="pointer-events-none absolute -bottom-10 -right-6 h-44 w-auto text-white/[0.07]" />
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a90a0]">
          <span className="brand-slash" aria-hidden />
          Model report card
        </p>
        <h1 className="mt-2 font-display text-[28px] font-extrabold uppercase italic leading-[0.95] tracking-tight">
          Every model,
          <br />
          <span className="text-[#c8f53a]">graded.</span>
        </h1>
        <p className="mt-2.5 max-w-[22rem] text-[13px] leading-snug text-[#8a90a0]">
          Each model is replayed on past games using only what was known before them, then checked: when it said 60%, did it
          hit 60%? And is it better than a coin flip or a simple average?
        </p>
        {cards.length > 0 && (
          <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {Object.entries(VERDICT).map(([k, v]) => (counts[k] ? <span key={k}>{counts[k]} {v.label.toLowerCase()}</span> : null))}
          </p>
        )}
      </div>

      {cards.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm font-semibold text-foreground">No report cards yet</p>
          <p className="mt-1 text-xs text-muted-foreground">They appear after the first Model lab run (GitHub → Actions → Model lab → report:all).</p>
        </div>
      ) : (
        sports.map((sport) => (
          <section key={sport} className="mt-6">
            <h2 className="mb-2 flex items-center gap-2 font-display text-sm font-extrabold uppercase italic tracking-wide text-foreground">
              <span className="brand-slash" aria-hidden />
              {sport.toUpperCase()}
            </h2>
            <div className="flex flex-col gap-2.5">
              {bySport.get(sport)!.map((c) => (
                <Card key={c.model} c={c} />
              ))}
            </div>
          </section>
        ))
      )}

      <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
        Skill is the Brier score improvement over predicting the base rate, ×1000 (higher is better). For props, &ldquo;vs
        average&rdquo; is how much smaller the projection&apos;s error is than the player&apos;s recent average. A model that
        isn&apos;t trusted still shows its numbers, but the market&apos;s fair price is the safer guide until it is.
      </p>
    </div>
  );
}
