"use client";

import { useMemo, useState } from "react";
import { unpackLog, type GameLogPoint } from "@/lib/nba/propsMath";
import type { WireNbaPropsSlate } from "@/lib/queries/nbaProps";
import { nbaFinderLegs } from "@/lib/nba/parlayLegs";
import { findParlays, type FoundParlay } from "@/lib/props/parlayFinder";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { ParlayTray } from "@/components/props/Parlay";
import type { ParlayLeg } from "@/lib/props/parlay";
import { EmptyList, GameChips, ListNote, Segmented, chip } from "@/components/props/kit";

const pct = (p: number) => `${Math.round(p * 100)}%`;

function startLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
}

type SeasonsKey = "both" | "this";
type ShortestKey = "-300" | "-500" | "-1000" | "any";
type LegRateKey = "0.6" | "0.7" | "0.8";

function ParlayCard({ p, onOpen }: { p: FoundParlay; onOpen: () => void }) {
  return (
    <li className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-foreground">
          All {p.legs.length} hit in <span className="font-mono font-semibold">{p.hits}</span> of {p.shared} shared games
        </p>
        <span className="font-mono text-lg font-bold text-emerald-600 dark:text-emerald-400">{pct(p.hits / p.shared)}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Last {p.last10.shared} together: <span className="font-mono">{p.last10.hits}/{p.last10.shared}</span>
        {p.priceAmerican !== null && (
          <>
            {" "}
            · <span className="font-mono text-foreground">{formatAmerican(p.priceAmerican)}</span> at these prices if unrelated
          </>
        )}
        {p.model !== null && (
          <>
            {" "}
            · ARCHR tonight <span className="font-mono text-foreground">{pct(p.model)}</span> if unrelated
          </>
        )}
      </p>
      <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
        {p.legs.map((l) => (
          <li key={l.key} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
            <span className="min-w-0 truncate">
              <span className="font-semibold text-foreground">{l.playerName}</span>{" "}
              <span className="text-muted-foreground">
                {l.sideLabel === "Yes" || l.sideLabel === "No" ? `${l.statShort} ${l.sideLabel}` : `${l.sideLabel} ${l.point} ${l.statShort}`}
              </span>
            </span>
            <span className="shrink-0 font-mono text-muted-foreground">
              {l.priceAmerican !== null ? formatAmerican(l.priceAmerican) : "—"}
              {l.bookName ? <span className="ml-1 font-sans text-[10px]">{l.bookName}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onOpen} className="mt-2 text-xs font-semibold text-foreground underline-offset-2 hover:underline">
        Every game they shared →
      </button>
    </li>
  );
}

/**
 * The parlay finder: pick a game, and it searches every line the books hang on
 * it (alt rungs included) for the same-game combinations, 2 legs to 15, whose
 * legs have all cashed together most often. Each opens in the parlay lab for
 * the game-by-game table.
 */
export function NbaParlayFinder({ slate }: { slate: WireNbaPropsSlate }) {
  const games = useMemo(() => slate.games.filter((g) => slate.props.some((p) => slate.players[p.playerId]?.gameId === g.id)), [slate]);
  const [gameId, setGameId] = useState<string | null>(games[0]?.id ?? null);
  const [seasons, setSeasons] = useState<SeasonsKey>("both");
  const [shortest, setShortest] = useState<ShortestKey>("-500");
  const [legRate, setLegRate] = useState<LegRateKey>("0.6");
  const [size, setSize] = useState<number | null>(null);
  const [lab, setLab] = useState<ParlayLeg[]>([]);

  const logs = useMemo(
    () => Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackLog)])) as Record<string, GameLogPoint[]>,
    [slate.logs]
  );
  const legs = useMemo(
    () => (gameId ? nbaFinderLegs(slate, logs, gameId, { shortestPrice: shortest === "any" ? -Infinity : Number(shortest) }) : []),
    [slate, logs, gameId, shortest]
  );
  const results = useMemo(
    () => findParlays(legs, { minLegRate: Number(legRate), seasons: seasons === "this" ? [slate.season] : [slate.season, slate.season - 1], minShared: seasons === "this" ? 4 : 10 }),
    [legs, legRate, seasons, slate.season]
  );
  const sizes = results.map((r) => r.size);
  const shown = results.find((r) => r.size === size) ?? results.find((r) => r.size === 4) ?? results[0];

  return (
    <>
      <GameChips
        games={games.map((g) => ({ id: g.id, away: g.away, home: g.home, start: startLabel(g.startUtc) }))}
        active={gameId}
        onSelect={(id) => id && setGameId(id)}
        allLabel="Pick a game"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Segmented<SeasonsKey>
          options={[
            { key: "both", label: "This + last season" },
            { key: "this", label: "This season" },
          ]}
          value={seasons}
          onChange={setSeasons}
        />
        <Segmented<LegRateKey>
          options={[
            { key: "0.6", label: "Legs 60%+" },
            { key: "0.7", label: "70%+" },
            { key: "0.8", label: "80%+" },
          ]}
          value={legRate}
          onChange={setLegRate}
        />
        <Segmented<ShortestKey>
          options={[
            { key: "-300", label: "No legs under −300" },
            { key: "-500", label: "−500" },
            { key: "-1000", label: "−1000" },
            { key: "any", label: "Any" },
          ]}
          value={shortest}
          onChange={setShortest}
        />
      </div>

      {sizes.length > 0 && (
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {sizes.map((n) => (
            <button key={n} type="button" onClick={() => setSize(n)} className={chip(n === shown?.size)}>
              {n} legs
            </button>
          ))}
        </div>
      )}

      <ListNote>
        {legs.length} lines on this game{shown ? ` · the ${shown.parlays.length === 1 ? "best" : `best ${shown.parlays.length}`} ${shown.size}-leg combinations by how often every leg cashed together` : ""}
      </ListNote>

      {!shown ? (
        <EmptyList title="No combination has cashed together often enough" hint="Try a lower leg hit rate, allow shorter-priced legs, or include last season." />
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {shown.parlays.map((p) => (
            <ParlayCard key={p.legs.map((l) => l.key).join("|")} p={p} onOpen={() => setLab(p.legs)} />
          ))}
        </ul>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        A shared game is one where every player in the parlay played. The finder tries thousands of combinations, so some records are partly luck: weigh
        ARCHR&apos;s chance beside each one. Books price same-game parlays below the &quot;if unrelated&quot; number when legs move together. Research only.
      </p>
      <ParlayTray legs={lab} season={slate.season} onRemove={(id) => setLab((l) => l.filter((x) => x.id !== id))} onClear={() => setLab([])} />
    </>
  );
}
