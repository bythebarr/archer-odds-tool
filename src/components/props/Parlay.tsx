"use client";

import { useEffect, useMemo, useState } from "react";
import { parlayHistory, type ParlayHistory, type ParlayLeg } from "@/lib/props/parlay";
import type { PropHitRateResult } from "@/lib/props/tally";
import { formatRate, rateTone } from "@/components/nba/HitMeter";

const pct = (p: number | null) => (p === null ? "—" : `${Math.round(p * 100)}%`);

function legLabel(l: ParlayLeg): string {
  return l.sideLabel === "Yes" || l.sideLabel === "No" ? `${l.statShort} ${l.sideLabel}` : `${l.sideLabel} ${l.point} ${l.statShort}`;
}

/** The button on a player sheet: add this line to the parlay, update it, or start over from another game. */
export function ParlayButton({ leg, legs, onAdd }: { leg: ParlayLeg; legs: ParlayLeg[]; onAdd: (leg: ParlayLeg) => void }) {
  const existing = legs.find((l) => l.id === leg.id);
  const otherGame = legs.length > 0 && legs[0].gameId !== leg.gameId;
  const same = existing && existing.point === leg.point && existing.side === leg.side;
  const label = otherGame
    ? `Start a new parlay with ${legLabel(leg)}`
    : same
      ? `✓ In your parlay · ${legLabel(leg)}`
      : existing
        ? `Update parlay leg to ${legLabel(leg)}`
        : `+ Add ${legLabel(leg)} to parlay`;
  return (
    <div>
      <button
        type="button"
        disabled={!!same}
        onClick={() => onAdd(leg)}
        className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
          same ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-brand bg-brand/10 text-foreground hover:bg-brand/20"
        }`}
      >
        {label}
      </button>
      {otherGame && (
        <p className="mt-1 text-[10px] text-muted-foreground">A parlay here is one game: this clears the {legs.length} leg{legs.length === 1 ? "" : "s"} from the other game.</p>
      )}
    </div>
  );
}

function Rate({ label, rate }: { label: string; rate: PropHitRateResult }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-1.5 text-center">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`font-mono text-base font-semibold ${rateTone(rate)}`}>{formatRate(rate)}</p>
      <p className="font-mono text-[10px] text-muted-foreground">
        {rate.hits}/{rate.sampleSize}
      </p>
    </div>
  );
}

function Verdict({ h }: { h: ParlayHistory }) {
  if (h.together.sampleSize === 0) {
    return <p className="text-xs text-muted-foreground">These players haven&apos;t played in the same game yet, so there&apos;s no history of the legs together.</p>;
  }
  const actual = h.together.hitRate ?? 0;
  const expected = h.independent ?? 0;
  const thin = h.together.sampleSize < 8;
  const gap = actual - expected;
  const read =
    Math.abs(gap) < 0.05
      ? "about as often as if the legs were unrelated"
      : gap > 0
        ? "more often than if the legs were unrelated: they've tended to hit together"
        : "less often than if the legs were unrelated: when one hits, the others have tended not to";
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      All {h.perLeg.length} legs hit together in <span className="font-semibold text-foreground">{h.together.hits}</span> of {h.together.sampleSize} games they shared ({pct(actual)}),{" "}
      {read}. Unrelated, you&apos;d expect {pct(expected)}.{thin ? " A small sample: read it as a lean, not a rate." : ""}
    </p>
  );
}

/** The parlay itself: every leg, how often they've all hit together, and each shared game. */
function ParlayPanel({ legs, season, onRemove, onClear, onClose }: { legs: ParlayLeg[]; season: number; onRemove: (id: string) => void; onClear: () => void; onClose: () => void }) {
  const h = useMemo(() => parlayHistory(legs, season), [legs, season]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Parlay">
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-background p-4 shadow-2xl sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3">
          <p className="font-display text-xl font-extrabold uppercase italic leading-none text-foreground">Parlay lab</p>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground">
              Clear
            </button>
            <button type="button" onClick={onClose} aria-label="Close parlay" className="text-xl leading-none text-muted-foreground hover:text-foreground">
              ×
            </button>
          </div>
        </div>

        <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
          {legs.map((l, i) => (
            <li key={l.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{l.playerName}</p>
                <p className="text-xs text-muted-foreground">
                  {legLabel(l)} · ARCHR {pct(l.modelProb)}
                </p>
              </div>
              {h.games.length > 0 && (
                <span className="text-right font-mono text-xs text-muted-foreground">
                  on its own {formatRate(h.perLeg[i])}
                  <span className="block text-[10px]">
                    {h.perLeg[i].hits}/{h.perLeg[i].sampleSize}
                  </span>
                </span>
              )}
              <button type="button" onClick={() => onRemove(l.id)} aria-label={`Remove ${l.playerName}`} className="px-1 text-lg leading-none text-muted-foreground hover:text-foreground">
                ×
              </button>
            </li>
          ))}
        </ul>

        {legs.length < 2 ? (
          <p className="mt-3 text-xs text-muted-foreground">Add another leg from this game: tap the game at the top of the board to see only its players, then tap one, pick a line and add it.</p>
        ) : (
          <>
            <p className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">All legs hit together</p>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              <Rate label="Last 10" rate={h.last10} />
              <Rate label="This szn" rate={h.thisSeason} />
              <Rate label="All shared" rate={h.together} />
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-center">
              <div className="rounded-lg bg-muted/60 px-2 py-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">If unrelated</p>
                <p className="font-mono text-base font-semibold text-foreground">{pct(h.independent)}</p>
              </div>
              <div className="rounded-lg bg-muted/60 px-2 py-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">ARCHR tonight, unrelated</p>
                <p className="font-mono text-base font-semibold text-foreground">{pct(h.model)}</p>
              </div>
            </div>
            <div className="mt-2.5">
              <Verdict h={h} />
            </div>

            {h.games.length > 0 && (
              <>
                <p className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Every game they shared</p>
                <div className="mt-1.5 overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-2 py-1.5 text-left font-medium">Game</th>
                        {legs.map((l) => (
                          <th key={l.id} className="px-1 py-1.5 text-center font-medium" title={`${l.playerName} ${legLabel(l)}`}>
                            {l.playerName.split(" ").slice(-1)[0]}
                          </th>
                        ))}
                        <th className="px-2 py-1.5 text-center font-medium">All</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {h.games.map((g) => (
                        <tr key={`${g.date}${g.matchup}`} className={g.all ? "bg-emerald-500/10" : ""}>
                          <td className="whitespace-nowrap px-2 py-1 font-mono text-[11px] text-muted-foreground">
                            {g.date.slice(5).replace("-", "/")}
                            {g.season !== season ? `/${String(g.season).slice(2)}` : ""} {g.matchup.replace("@", " @ ")}
                          </td>
                          {g.legs.map((hit, i) => (
                            <td key={legs[i].id} className={`px-1 py-1 text-center font-semibold ${hit ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                              {hit ? "✓" : "✗"}
                            </td>
                          ))}
                          <td className={`px-2 py-1 text-center font-bold ${g.all ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>{g.all ? "✓" : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
        <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
          A shared game is one where every player in the parlay played and every stat was recorded. Research only: past games don&apos;t guarantee the next one.
        </p>
      </div>
    </div>
  );
}

/** The parlay bar above the bottom nav, and the panel it opens. Hidden until there's a leg. */
export function ParlayTray({ legs, season, onRemove, onClear }: { legs: ParlayLeg[]; season: number; onRemove: (id: string) => void; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const h = useMemo(() => parlayHistory(legs, season), [legs, season]);
  if (legs.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed inset-x-4 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-brand bg-background/95 px-4 py-2.5 text-left shadow-lg backdrop-blur sm:bottom-4"
        style={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom))" }}
      >
        <span className="text-sm font-semibold text-foreground">
          Parlay · {legs.length} leg{legs.length === 1 ? "" : "s"}
        </span>
        <span className="text-xs text-muted-foreground">
          {legs.length < 2 ? (
            "add another leg"
          ) : h.together.sampleSize === 0 ? (
            "no shared games yet"
          ) : (
            <>
              hit together <span className={`font-mono font-semibold ${rateTone(h.together)}`}>{h.together.hits}/{h.together.sampleSize}</span>
            </>
          )}
        </span>
      </button>
      {open && <ParlayPanel legs={legs} season={season} onRemove={onRemove} onClear={() => (onClear(), setOpen(false))} onClose={() => setOpen(false)} />}
    </>
  );
}
