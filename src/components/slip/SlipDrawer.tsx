"use client";

import { useMemo, useState } from "react";
import { useSlip, type SlipPick } from "@/lib/slip/SlipContext";
import { americanToDecimal, decimalToAmerican, formatAmerican } from "@/lib/odds/americanOdds";
import { formatPoint } from "@/lib/odds/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { BookBadge } from "../BookBadge";

const DEFAULT_STAKE = 10;

function formatMoney(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function PickRow({ pick, onRemove }: { pick: SlipPick; onRemove: () => void }) {
  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{pick.selectionLabel}</p>
        <p className="truncate text-xs text-muted-foreground">{pick.matchLabel}</p>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <BookBadge bookKey={pick.bookKey} bookName={pick.bookName} size={14} />
          {pick.bookName}
          {pick.point !== null && pick.marketType !== "prop" && (
            <span>· {formatPoint(pick.point, pick.marketType)}</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="font-mono text-sm font-semibold text-foreground">
          {formatAmerican(pick.priceAmerican)}
        </span>
        <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${pick.selectionLabel} from slip`}>
          <svg viewBox="0 0 16 16" fill="none" className="size-3.5">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </Button>
      </div>
    </li>
  );
}

interface SlipDrawerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The slip panel: lists every marked pick with a remove control, and a
 * combined-odds preview (standard multiplicative parlay math on decimal
 * odds) purely as a research convenience — this doesn't place any bet
 * anywhere (see SlipContext's docstring / the site footer).
 */
export function SlipDrawer({ open, onClose }: SlipDrawerProps) {
  const { picks, removePick, clearSlip } = useSlip();
  const [stake, setStake] = useState(String(DEFAULT_STAKE));

  const combinedDecimal = useMemo(
    () => picks.reduce((product, p) => product * americanToDecimal(p.priceAmerican), 1),
    [picks]
  );
  const combinedAmerican = picks.length >= 2 ? decimalToAmerican(combinedDecimal) : null;

  const stakeValue = Number(stake);
  const validStake = Number.isFinite(stakeValue) && stakeValue > 0;
  const payout = validStake ? stakeValue * combinedDecimal : null;
  const profit = payout !== null ? payout - stakeValue : null;

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close slip"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-[1px]"
        />
      )}
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-border bg-background shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Slip {picks.length > 0 && `(${picks.length})`}</h2>
          <div className="flex items-center gap-1">
            {picks.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearSlip}>
                Clear
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close slip">
              <svg viewBox="0 0 16 16" fill="none" className="size-3.5">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4">
          {picks.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No picks yet. Add one from any line-shopping page.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {picks.map((pick) => (
                <PickRow key={pick.id} pick={pick} onRemove={() => removePick(pick.id)} />
              ))}
            </ul>
          )}
        </div>

        {picks.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3 px-4 py-3">
              {combinedAmerican !== null && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Combined odds ({picks.length} picks)</span>
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {formatAmerican(combinedAmerican)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="slip-stake" className="text-sm text-muted-foreground">
                  {picks.length >= 2 ? "Parlay stake" : "Stake"}
                </label>
                <div className="relative w-28">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <Input
                    id="slip-stake"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="1"
                    value={stake}
                    onChange={(e) => setStake(e.target.value)}
                    className="pl-5 text-right font-mono"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">To win</span>
                <span className="font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  {profit !== null ? formatMoney(profit) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total payout</span>
                <span className="font-mono text-sm font-semibold text-foreground">
                  {payout !== null ? formatMoney(payout) : "—"}
                </span>
              </div>
            </div>
          </>
        )}

        <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          Research tracking only — this does not place a bet. Odds shown may have moved since a pick was added.
        </div>
      </aside>
    </>
  );
}
