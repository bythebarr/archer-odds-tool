"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { TeamBadge } from "@/components/TeamBadge";
import type { NflPropsBoard as BoardData } from "@/lib/nfl/props/board";
import type { ServedMarket as PropMarket } from "@/lib/nfl/props/frozen";
import { poissonOver } from "@/lib/nfl/props/td";
import { MARKET_META, MARKET_ORDER } from "./marketMeta";
import { NflPropRow } from "./NflPropRow";
import { manualKey, useManualLines } from "./useManualLines";

type SortKey = "projection" | "vsAvg" | "name";

function kickoffLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
}

export function NflPropsBoard({ board }: { board: BoardData }) {
  const [market, setMarket] = useState<PropMarket>("receivingYards");
  const isAnytime = market === "anytimeTd" || market === "twoPlusTds";
  const fixedLine = market === "twoPlusTds" ? 1.5 : 0.5;
  const [game, setGame] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("projection");
  const { lines, set } = useManualLines();

  const counts = useMemo(() => {
    const c = {} as Record<PropMarket, number>;
    for (const m of MARKET_ORDER) c[m] = 0;
    for (const r of board.rows) if (!game || r.eventRef === game) c[r.market]++;
    return c;
  }, [board.rows, game]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = board.rows.filter(
      (r) =>
        r.market === market &&
        (!game || r.eventRef === game) &&
        (!q || r.name.toLowerCase().includes(q) || r.team.abbreviation.toLowerCase() === q || r.team.name.toLowerCase().includes(q))
    );
    // anytime TD compares a probability to a rate, so its "vs avg" is in points, not percent
    const vsAvg = (r: (typeof filtered)[number]) =>
      isAnytime ? poissonOver(r.mean, fixedLine) - (r.seasonAvg ?? 0) : r.seasonAvg ? (r.mean - r.seasonAvg) / r.seasonAvg : 0;
    return filtered.sort((a, b) =>
      sort === "projection" ? b.mean - a.mean : sort === "vsAvg" ? vsAvg(b) - vsAvg(a) : a.name.localeCompare(b.name)
    );
  }, [board.rows, market, game, query, sort, isAnytime, fixedLine]);

  return (
    <div className="mt-5">
      {/* games rail */}
      <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-2">
          <button
            type="button"
            onClick={() => setGame(null)}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
              game === null ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            All games
            <span className="ml-1.5 font-normal opacity-70">{board.games.length}</span>
          </button>
          {board.games.map((g) => {
            const active = game === g.eventRef;
            return (
              <button
                key={g.eventRef}
                type="button"
                onClick={() => setGame(active ? null : g.eventRef)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left transition-colors ${
                  active ? "border-foreground bg-foreground/5" : "border-border bg-card hover:border-foreground/30"
                }`}
              >
                <span className="flex -space-x-1">
                  <TeamBadge abbreviation={g.away.abbreviation} name={g.away.name} size={18} />
                  <TeamBadge abbreviation={g.home.abbreviation} name={g.home.name} size={18} />
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-xs font-semibold text-foreground">
                    {g.away.abbreviation} @ {g.home.abbreviation}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {kickoffLabel(g.kickoffUtc)}
                    {g.total !== null ? ` · o/u ${g.total}` : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* sticky controls */}
      <div className="sticky top-0 z-10 -mx-4 mt-3 border-b border-border bg-background/90 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-3">
        <div className="-mx-1 overflow-x-auto">
          <div role="tablist" aria-label="Prop market" className="flex w-max gap-1 px-1">
            {MARKET_ORDER.map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={market === m}
                type="button"
                onClick={() => setMarket(m)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  market === m ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {MARKET_META[m].short}
                <span className="ml-1 font-normal opacity-60">{counts[m]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Input
            type="search"
            placeholder="Search player or team"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 flex-1 text-xs"
            aria-label="Search player or team"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
            aria-label="Sort"
          >
            <option value="projection">Top projection</option>
            <option value="vsAvg">Biggest vs season avg</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      <div className="mt-3 flex items-baseline justify-between px-1 text-[11px] text-muted-foreground">
        <span>
          {rows.length} player{rows.length === 1 ? "" : "s"} · {MARKET_META[market].label}
        </span>
        <span>Tap &ldquo;Why&rdquo; for the breakdown</span>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        {rows.map((r) => {
          const key = manualKey(r.eventRef, r.market, r.playerId);
          return <NflPropRow key={key} row={r} manual={lines[key]} onManual={(next) => set(key, next)} />;
        })}
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No {MARKET_META[market].label.toLowerCase()} projections match.
          </p>
        ) : null}
      </div>
    </div>
  );
}
