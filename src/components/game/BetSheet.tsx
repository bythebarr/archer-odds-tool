"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { buildSlipPickId, useSlip, type SlipSport } from "@/lib/slip/SlipContext";
import type { Offer, OfferSide } from "@/lib/gameModel/offers";
import { BookBadge } from "@/components/BookBadge";
import { offerTitle, sideLabel, type TeamNames } from "./labels";

const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);

/** The one-line read: ARCHR's chance against what the price implies. */
function verdictLine(side: OfferSide, edge: number | null): string {
  if (side.prob === null || !side.best || edge === null) return "No ARCHR read on this line yet.";
  const implied = side.best.priceAmerican > 0 ? 100 / (side.best.priceAmerican + 100) : -side.best.priceAmerican / (-side.best.priceAmerican + 100);
  const head = edge >= 0.05 ? "Strong value" : edge >= 0.02 ? "Value" : edge >= -0.02 ? "Fair price" : "Overpriced";
  return `${head} — ARCHR ${pct(side.prob)} vs the price's ${pct(implied)}.`;
}
const MARKET_TYPE = { ml: "h2h", spread: "spreads", total: "totals", teamTotal: "totals" } as const;

/**
 * One bet, run against the model: the line and every book's price on it, and
 * ARCHR's read — the model alone, the books' no-vig consensus, the blend we
 * price with, its fair price, the push chance and the EV of each book's price.
 * Switch sides in place; add any book's price to the slip.
 */
export function BetSheet({
  offer,
  sideKey,
  onSide,
  teams,
  sport,
  matchId,
  matchLabel,
  onClose,
}: {
  offer: Offer;
  sideKey: string;
  onSide: (side: string) => void;
  teams: TeamNames;
  sport: SlipSport;
  matchId: string;
  matchLabel: string;
  onClose: () => void;
}) {
  const side: OfferSide = offer.sides.find((s) => s.side === sideKey) ?? offer.sides[0];
  const { addPick, removePick, isInSlip } = useSlip();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const label = sideLabel(offer, side, teams);
  const edge = side.ev ?? null;
  const pickFor = (book: OfferSide["books"][number]) => {
    const marketType = MARKET_TYPE[offer.kind];
    const id = buildSlipPickId({ sport, matchId, marketType, side: `${offer.period}:${side.side}:${offer.team}`, point: side.point, bookKey: book.bookKey });
    return { id, marketType };
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-in fade-in-0" onClick={onClose} />
      <div className="relative max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-background shadow-2xl animate-in slide-in-from-bottom-8 duration-200 sm:max-w-md sm:rounded-2xl sm:slide-in-from-bottom-0 sm:zoom-in-95">
        <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 pb-3 pt-2 backdrop-blur">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30 sm:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{offerTitle(offer)} · {matchLabel}</p>
              <p className="mt-0.5 truncate font-display text-xl font-extrabold italic text-foreground">{label}</p>
            </div>
            <button ref={closeRef} type="button" onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close bet">
              ✕
            </button>
          </div>
          <div className="mt-3 flex gap-1.5">
            {offer.sides.map((s) => (
              <button
                key={s.side}
                type="button"
                onClick={() => onSide(s.side)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${s.side === side.side ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
              >
                {sideLabel(offer, s, teams, true)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4 px-4 py-4">
          <section className="rounded-xl border border-border bg-card p-3.5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Best price</p>
                {side.best ? (
                  <p className="mt-0.5 flex items-center gap-2 font-mono text-3xl font-semibold leading-none text-foreground">
                    {formatAmerican(side.best.priceAmerican)}
                    <BookBadge bookKey={side.best.bookKey} bookName={side.best.bookName} size={24} />
                  </p>
                ) : (
                  <p className="mt-0.5 text-sm text-muted-foreground">No bettable book</p>
                )}
              </div>
              {edge !== null && (
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">ARCHR EV</p>
                  <p className={`font-mono text-2xl font-bold leading-none ${edge >= 0.02 ? "text-emerald-600 dark:text-brand" : edge < 0 ? "text-muted-foreground" : "text-foreground"}`}>
                    {edge >= 0 ? "+" : ""}
                    {(edge * 100).toFixed(1)}%
                  </p>
                </div>
              )}
            </div>
            <p className={`mt-3 text-sm font-semibold ${edge === null ? "text-muted-foreground" : edge >= 0.02 ? "text-emerald-600 dark:text-brand" : edge >= -0.02 ? "text-foreground" : "text-muted-foreground"}`}>
              {verdictLine(side, edge)}
            </p>
            <details className="group mt-3 rounded-lg bg-muted/40 px-3 py-2">
              <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Model breakdown
                <span className="transition-transform group-open:rotate-180" aria-hidden>
                  ▾
                </span>
              </summary>
            <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
                <div className="rounded-lg bg-muted/60 px-2 py-1.5">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Model</p>
                  <p className="font-mono text-sm font-semibold text-foreground">{pct(side.modelProb)}</p>
                </div>
                <div className="rounded-lg bg-muted/60 px-2 py-1.5">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Market · {offer.books} books</p>
                  <p className="font-mono text-sm font-semibold text-foreground">{pct(side.marketProb)}</p>
                </div>
                <div className="rounded-lg bg-brand/15 px-2 py-1.5 ring-1 ring-brand/40">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">ARCHR</p>
                  <p className="font-mono text-sm font-bold text-foreground">{pct(side.prob)}</p>
                </div>
              </div>
              <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
                {side.fairAmerican !== null && (
                  <>
                    Fair price <span className="font-mono font-semibold text-foreground">{formatAmerican(side.fairAmerican)}</span>
                    {side.push >= 0.005 ? <> · push {pct(side.push)} (refunded)</> : null}.{" "}
                  </>
                )}
                {side.prob === null
                  ? "The game model needs both teams to have enough games before it prices this."
                  : "The model's chance blended with the books' no-vig consensus; EV is what the best price returns per unit at that chance."}{" "}
                <Link href="/models" className="font-semibold text-foreground underline-offset-2 hover:underline">
                  How accurate is it?
                </Link>
              </p>
            </details>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Every book · {label}</h3>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {side.books.map((b) => {
                const { id, marketType } = pickFor(b);
                const inSlip = isInSlip(id);
                const ev = side.prob !== null ? side.prob * (1 - side.push) * (b.priceAmerican > 0 ? b.priceAmerican / 100 : 100 / -b.priceAmerican) - (1 - side.prob * (1 - side.push) - side.push) : null;
                return (
                  <li key={b.bookKey} className="flex items-center gap-2.5 px-3 py-2">
                    <BookBadge bookKey={b.bookKey} bookName={b.bookName} size={22} />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {b.bookName}
                      {!b.bettable && <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">reference</span>}
                    </span>
                    {ev !== null && <span className={`font-mono text-[11px] ${ev >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>{ev >= 0 ? "+" : ""}{(ev * 100).toFixed(1)}%</span>}
                    <span className={`w-14 text-right font-mono text-sm font-semibold ${b.bookKey === side.best?.bookKey ? "text-foreground" : "text-muted-foreground"}`}>{formatAmerican(b.priceAmerican)}</span>
                    {b.bettable ? (
                      <button
                        type="button"
                        aria-pressed={inSlip}
                        onClick={() =>
                          inSlip
                            ? removePick(id)
                            : addPick({
                                id,
                                sport,
                                matchId,
                                matchLabel,
                                selectionLabel: `${label} · ${offerTitle(offer)}`,
                                marketType,
                                point: offer.kind === "ml" ? null : side.point,
                                bookKey: b.bookKey,
                                bookName: b.bookName,
                                priceAmerican: b.priceAmerican,
                                ev,
                                addedAt: Date.now(),
                              })
                        }
                        className={`rounded-md px-2 py-1 text-[11px] font-bold ${inSlip ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted-foreground/15"}`}
                      >
                        {inSlip ? "Added" : "+ Slip"}
                      </button>
                    ) : (
                      <span className="w-[52px]" />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
