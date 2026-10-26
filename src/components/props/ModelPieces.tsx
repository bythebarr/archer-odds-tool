/**
 * The pieces every sport's projection panel shares, so a new sport's sheet
 * explains its numbers the same way: what the model says vs the market and the
 * blend, how much rests on last season, and what tonight's lines changed.
 */
import type { PricedProp } from "@/lib/propModel/price";
import type { SeasonMix } from "@/lib/propModel/seasonMix";
import type { PropDirection } from "@/lib/props/tally";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (x: number) => (x > 0 ? `+${x}` : `${x}`);

/** Model alone → market → the blend we price with, for the chosen side. */
export function BlendLine({ model, side }: { model: PricedProp; side: PropDirection }) {
  const flip = (p: number) => (side === "over" ? p : 1 - p);
  const label = side === "over" ? "Over" : "Under";
  return (
    <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
      <div className="rounded-lg bg-muted/60 px-2 py-1.5">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Model {label}</p>
        <p className="font-mono text-sm font-semibold text-foreground">{pct(flip(model.modelProbOver))}</p>
      </div>
      <div className="rounded-lg bg-muted/60 px-2 py-1.5">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Market{model.market ? ` · ${model.market.books} books` : ""}</p>
        <p className="font-mono text-sm font-semibold text-foreground">{model.market ? pct(flip(model.market.probOver)) : "—"}</p>
      </div>
      <div className="rounded-lg bg-brand/15 px-2 py-1.5 ring-1 ring-brand/40">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">ARCHR {label}</p>
        <p className="font-mono text-sm font-bold text-foreground">{pct(flip(model.probOver))}</p>
      </div>
      <p className="col-span-3 text-left text-[10px] leading-relaxed text-muted-foreground">
        {model.market
          ? model.weightFitted
            ? `The model gets ${pct(model.modelWeight)} of the vote against the books' no-vig consensus — the weight the backtest on real closing prices finds most accurate.`
            : `The model gets ${pct(model.modelWeight)} of the vote against the books' no-vig consensus — a conservative default until the backtest on real closing prices fits this stat.`
          : "Too few books price both sides for a market read, so the model stands alone, pulled toward 50%."}
      </p>
    </div>
  );
}

/** This season vs last: the games, the averages, and how much of the projection leans on last season. */
export function SeasonMixLine({ seasons, digits = 1 }: { seasons: SeasonMix; digits?: number }) {
  const avg = (x: number | null) => (x === null ? "—" : x.toFixed(digits));
  return (
    <div className="mt-3 grid grid-cols-2 gap-1.5">
      <div className="rounded-lg bg-muted/60 px-2.5 py-1.5">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">This season · {seasons.current.games} gp</p>
        <p className="font-mono text-sm font-semibold text-foreground">{avg(seasons.current.avg)}</p>
      </div>
      <div className="rounded-lg bg-muted/60 px-2.5 py-1.5">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Last season · {seasons.last.games} gp</p>
        <p className="font-mono text-sm font-semibold text-foreground">{avg(seasons.last.avg)}</p>
      </div>
      <p className="col-span-2 text-[10px] leading-relaxed text-muted-foreground">
        {pct(seasons.lastShare)} of the projection rests on last season
        {seasons.lastShare >= 0.5 ? " — early in the year, his larger sample still carries the most weight." : "; this season now carries the most weight."}
      </p>
    </div>
  );
}

/** What tonight's game lines did to the projection. */
export function EnvLine({ parts, effects }: { parts: string[]; effects: { label: string; factor: number }[] }) {
  const moved = effects.filter((e) => Math.abs(e.factor - 1) >= 0.005);
  if (parts.length === 0) return null;
  return (
    <p className="mt-3 rounded-lg bg-muted/60 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
      <span className="font-semibold text-foreground">Game lines:</span> {parts.join(" · ")}
      {moved.length > 0 ? ` → ${moved.map((e) => `${e.label} ×${e.factor.toFixed(2)}`).join(", ")}` : " → no adjustment"}.
    </p>
  );
}

export { signed };
