"use client";

/**
 * One player × market on the NFL props board. Every number shown is either
 * stored at capture (projection, breakdown, baselines) or computed by the
 * shared, frozen pricing code from a line the viewer typed in — the component
 * holds no model logic of its own.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/Logo";
import { TeamBadge } from "@/components/TeamBadge";
import { loadFrozenModel } from "@/lib/nfl/props/frozen";
import { priceProp } from "@/lib/nfl/props/pricing";
import type { NflPropsBoardRow } from "@/lib/nfl/props/board";
import { MARKET_META } from "./marketMeta";
import type { ManualLine } from "./useManualLines";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[parts.length - 1][0] ?? "")).toUpperCase();
}

function fmtOdds(american: number): string {
  return american > 0 ? `+${american}` : `${american}`;
}

function parseNum(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseOdds(raw: string): number | null {
  const n = parseNum(raw);
  return n !== null && Math.abs(n) >= 100 && Math.abs(n) <= 10000 ? Math.round(n) : null;
}

/** Markets settled as yes/no at a fixed line. */
const YES_NO_LINE: Partial<Record<NflPropsBoardRow["market"], number>> = { anytimeTd: 0.5, twoPlusTds: 1.5 };

const SHARE_LABEL: Partial<Record<NflPropsBoardRow["market"], string>> = {
  anytimeTd: "TD share",
  twoPlusTds: "TD share",
  passingTds: "attempt share",
  interceptions: "INT rate",
};

interface Props {
  row: NflPropsBoardRow;
  manual: ManualLine | undefined;
  onManual: (next: ManualLine | null) => void;
}

export function NflPropRow({ row, manual, onManual }: Props) {
  const [open, setOpen] = useState(false);
  const meta = MARKET_META[row.market];
  // Yes/no markets (anytime TD, 2+ TDs) have a fixed line: headline the calibrated chance, compare it to the player's rate.
  const fixedLine = YES_NO_LINE[row.market];
  const isAnytime = fixedLine !== undefined;
  const model = loadFrozenModel();
  const tdChance = isAnytime ? model.pOver(row.market, row.mean, fixedLine) : null;
  const chanceLabel = row.market === "twoPlusTds" ? "2+ TD chance" : "TD chance";
  const headline = tdChance ?? row.mean;
  const fmt = (v: number) => (isAnytime ? `${Math.round(v * 100)}%` : v.toFixed(meta.decimals));
  const diff = row.seasonAvg === null ? null : headline - row.seasonAvg;
  const diffPct = row.seasonAvg === null ? null : isAnytime ? diff! : row.seasonAvg ? diff! / row.seasonAvg : null;

  const line = isAnytime ? fixedLine : manual?.line ?? null;
  const priced =
    line !== null && (manual || isAnytime)
      ? priceProp(model, row.mean, { market: row.market, line, overAmerican: manual?.over ?? null, underAmerican: isAnytime ? null : manual?.under ?? null })
      : null;

  const b = row.breakdown;
  const matchup =
    b.oppFactor === null ? null : b.oppFactor >= 1.02 ? "soft" : b.oppFactor <= 0.98 ? "tough" : "neutral";
  const maxBar = isAnytime ? 1 : Math.max(row.mean, row.seasonAvg ?? 0, row.l5Avg ?? 0, 1);

  return (
    <div className="rounded-xl border border-border bg-card transition-colors hover:border-foreground/20">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2.5 p-3 sm:gap-x-4">
        {/* player */}
        <Logo sources={row.headshotUrl ? [row.headshotUrl] : []} alt={row.name} fallbackText={initials(row.name)} size={44} className="rounded-full" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">{row.name}</span>
            {row.teammatesOut ? (
              <Badge variant="outline" className="h-4 border-sky-400 px-1 text-[9px] text-sky-700 dark:text-sky-300" title={`Absorbing usage: ${row.teammatesOut}`}>
                +usage
              </Badge>
            ) : null}
            {row.injury ? (
              <Badge variant="outline" className="h-4 border-amber-400 px-1 text-[9px] text-amber-700 dark:text-amber-300" title={`Injury report: ${row.injury}`}>
                Q
              </Badge>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium">{row.position}</span>
            <span aria-hidden>·</span>
            <TeamBadge abbreviation={row.team.abbreviation} name={row.team.name} size={14} />
            <span>{row.team.abbreviation}</span>
            <span className="text-muted-foreground/60">vs</span>
            <span>{row.opp.abbreviation}</span>
          </div>
        </div>

        {/* projection */}
        <div className="text-right">
          <div className="font-mono text-2xl font-bold leading-none tabular-nums text-foreground">{fmt(headline)}</div>
          <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{isAnytime ? chanceLabel : "ARCHR proj"}</div>
          {diffPct !== null ? (
            <div
              className={`mt-0.5 text-[11px] font-medium tabular-nums ${
                diffPct >= 0.05 ? "text-emerald-600 dark:text-emerald-400" : diffPct <= -0.05 ? "text-rose-500 dark:text-rose-400" : "text-muted-foreground"
              }`}
              title="Model projection vs. the player's season average"
            >
              {diff! >= 0 ? "▲" : "▼"} {isAnytime ? `${Math.round(Math.abs(diff!) * 100)} pts vs ${row.market === "twoPlusTds" ? "2+ TD" : "TD"} rate` : `${fmt(Math.abs(diff!))} vs avg`}
            </div>
          ) : null}
        </div>

        {/* line pricing */}
        <div className="col-span-3 flex items-center gap-3">
          {isAnytime ? (
            <>
              <label className="sr-only" htmlFor={`yes-${row.eventRef}-${row.playerId}`}>
                {meta.label} price for {row.name}
              </label>
              <Input
                id={`yes-${row.eventRef}-${row.playerId}`}
                key={`yes-${manual?.over ?? "none"}`}
                inputMode="numeric"
                placeholder="Price"
                defaultValue={manual?.over != null ? fmtOdds(manual.over) : ""}
                onBlur={(e) => {
                  const over = parseOdds(e.target.value);
                  onManual(over === null ? null : { line: fixedLine!, over, under: null });
                }}
                className="h-9 w-20 text-center font-mono text-sm"
              />
            </>
          ) : (
            <>
              <label className="sr-only" htmlFor={`line-${row.eventRef}-${row.market}-${row.playerId}`}>
                {meta.label} line for {row.name}
              </label>
              <Input
                id={`line-${row.eventRef}-${row.market}-${row.playerId}`}
                key={`line-${manual?.line ?? "none"}`}
                inputMode="decimal"
                placeholder="Line"
                defaultValue={manual?.line ?? ""}
                onBlur={(e) => {
                  const line = parseNum(e.target.value);
                  onManual(line === null ? null : { line, over: manual?.over ?? null, under: manual?.under ?? null });
                }}
                className="h-9 w-20 text-center font-mono text-sm"
              />
            </>
          )}
          {priced && isAnytime ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 text-[11px] tabular-nums">
              <span className="text-muted-foreground">fair {fmtOdds(priced.fairOverAmerican)}</span>
              {priced.evOver !== null ? <EvTag side="Yes" ev={priced.evOver} /> : <span className="text-muted-foreground/70">enter a price for EV</span>}
            </div>
          ) : priced ? (
            <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-sm">
              <div className="flex justify-between text-[11px] font-semibold tabular-nums">
                <span className={priced.pOver >= 0.5 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>O {Math.round(priced.pOver * 100)}%</span>
                <span className={priced.pUnder > 0.5 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>U {Math.round(priced.pUnder * 100)}%</span>
              </div>
              <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="bg-emerald-500/80" style={{ width: `${priced.pOver * 100}%` }} />
                <div className="bg-rose-400/60" style={{ width: `${priced.pUnder * 100}%` }} />
              </div>
              <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
                <span>fair {fmtOdds(priced.fairOverAmerican)}</span>
                <span>fair {fmtOdds(priced.fairUnderAmerican)}</span>
              </div>
            </div>
          ) : (
            <span className="text-[11px] text-muted-foreground/70">Enter a line</span>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-auto shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-expanded={open}
          >
            {open ? "Hide" : "Why"}
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-border bg-muted/20 px-3 py-3 text-xs">
          {/* the projection, as an equation */}
          {b.parts ? (
            <div className="flex flex-wrap items-center gap-1.5 font-mono tabular-nums">
              {b.parts.map((x, i) => (
                <span key={x.label} className="contents">
                  {i > 0 ? <span className="text-muted-foreground">+</span> : null}
                  <Chip value={x.value.toFixed(1)} label={x.label} />
                </span>
              ))}
              <span className="text-muted-foreground">=</span>
              <Chip value={fmt(row.mean)} label={meta.unit} strong />
            </div>
          ) : (
          <div className="flex flex-wrap items-center gap-1.5 font-mono tabular-nums">
            <Chip value={b.teamVolume.toFixed(1)} label={b.volumeLabel} />
            <span className="text-muted-foreground">×</span>
            <Chip
              value={`${(b.share * 100).toFixed(row.market === "interceptions" ? 2 : 1)}%`}
              label={SHARE_LABEL[row.market] ?? "player share"}
            />
            {b.efficiency !== null ? (
              <>
                <span className="text-muted-foreground">×</span>
                <Chip value={b.efficiencyLabel?.includes("rate") ? `${(b.efficiency * 100).toFixed(1)}%` : b.efficiency.toFixed(2)} label={b.efficiencyLabel ?? ""} />
              </>
            ) : null}
            {b.oppFactor !== null ? (
              <>
                <span className="text-muted-foreground">×</span>
                {row.market === "interceptions" ? (
                  <Chip value={b.oppFactor.toFixed(3)} label="def INT factor" />
                ) : (
                  <Chip value={b.oppFactor.toFixed(3)} label={`${matchup} matchup`} tone={matchup === "soft" ? "good" : matchup === "tough" ? "bad" : undefined} />
                )}
              </>
            ) : null}
            <span className="text-muted-foreground">=</span>
            <Chip value={isAnytime ? row.mean.toFixed(2) : fmt(row.mean)} label={meta.unit} strong />
            {isAnytime ? (
              <>
                <span className="text-muted-foreground">→</span>
                <Chip value={fmt(headline)} label={chanceLabel} strong />
              </>
            ) : null}
          </div>
          )}

          {row.teammatesOut ? (
            <p className="mt-2 rounded-md bg-sky-500/10 px-2 py-1.5 text-[11px] text-sky-800 dark:text-sky-200">
              Share bumped for the vacated carries: {row.teammatesOut} on the injury report.
            </p>
          ) : null}

          {/* projection vs naive baselines */}
          <div className="mt-3 grid gap-1.5">
            {[
              { label: "ARCHR", v: headline, cls: "bg-foreground/80" },
              { label: isAnytime ? (row.market === "twoPlusTds" ? "Season 2+ rate" : "Season TD rate") : "Season avg", v: row.seasonAvg, cls: "bg-muted-foreground/40" },
              { label: "Last 5", v: row.l5Avg, cls: "bg-muted-foreground/25" },
            ].map((x) =>
              x.v === null ? null : (
                <div key={x.label} className="grid grid-cols-[5.5rem_1fr_3rem] items-center gap-2">
                  <span className="text-muted-foreground">{x.label}</span>
                  <div className="h-2 rounded-full bg-muted">
                    <div className={`h-2 rounded-full ${x.cls}`} style={{ width: `${(x.v / maxBar) * 100}%` }} />
                  </div>
                  <span className="text-right font-mono tabular-nums">{fmt(x.v)}</span>
                </div>
              )
            )}
          </div>

          {/* optional prices → EV (anytime TD takes its single price in the row) */}
          <div className={`mt-3 flex flex-wrap items-end gap-2 ${isAnytime ? "hidden" : ""}`}>
            <OddsField
              id={`over-${row.eventRef}-${row.market}-${row.playerId}`}
              label="Over price"
              value={manual?.over ?? null}
              disabled={!manual || manual.line === null}
              onCommit={(over) => manual && onManual({ ...manual, over })}
            />
            <OddsField
              id={`under-${row.eventRef}-${row.market}-${row.playerId}`}
              label="Under price"
              value={manual?.under ?? null}
              disabled={!manual || manual.line === null}
              onCommit={(under) => manual && onManual({ ...manual, under })}
            />
            {priced && (priced.evOver !== null || priced.evUnder !== null) ? (
              <div className="flex gap-2 pb-1 font-mono text-[11px] tabular-nums">
                {priced.evOver !== null ? <EvTag side="Over" ev={priced.evOver} /> : null}
                {priced.evUnder !== null ? <EvTag side="Under" ev={priced.evUnder} /> : null}
                {priced.marketPOver !== null ? (
                  <span className="text-muted-foreground">mkt O {Math.round(priced.marketPOver * 100)}%</span>
                ) : null}
              </div>
            ) : null}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground/80">
            {row.priorGames} prior games · lines and prices you enter stay in this browser · experimental model, not yet
            tested against sportsbook lines
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Chip({ value, label, strong, tone }: { value: string; label: string; strong?: boolean; tone?: "good" | "bad" }) {
  const toneCls = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "bad" ? "text-rose-500 dark:text-rose-400" : "text-foreground";
  return (
    <span className={`inline-flex flex-col items-center rounded-lg border border-border bg-background px-2 py-1 ${strong ? "border-foreground/30" : ""}`}>
      <span className={`text-sm font-semibold ${toneCls}`}>{value}</span>
      <span className="font-sans text-[9px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </span>
  );
}

function EvTag({ side, ev }: { side: string; ev: number }) {
  const cls = ev >= 0.03 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : ev <= -0.03 ? "bg-rose-500/10 text-rose-600 dark:text-rose-300" : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded px-1.5 py-0.5 ${cls}`}>
      {side} EV {ev >= 0 ? "+" : ""}
      {(ev * 100).toFixed(1)}%
    </span>
  );
}

function OddsField({ id, label, value, disabled, onCommit }: { id: string; label: string; value: number | null; disabled: boolean; onCommit: (v: number | null) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        key={`${id}-${value ?? "none"}`}
        inputMode="numeric"
        placeholder="-110"
        disabled={disabled}
        defaultValue={value != null ? fmtOdds(value) : ""}
        onBlur={(e) => onCommit(parseOdds(e.target.value))}
        className="h-8 w-20 text-center font-mono text-xs"
      />
    </div>
  );
}
