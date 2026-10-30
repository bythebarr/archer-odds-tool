"use client";

import { useCallback, useMemo } from "react";
import { unpackNflLog, type NflLogPoint, type PackedNflLog } from "@/lib/nfl/propsMath";
import type { NflPropsSlate } from "@/lib/queries/nflProps";
import { nflFinderLegs } from "@/lib/nfl/parlayLegs";
import { ParlayFinder } from "@/components/props/ParlayFinder";

/** A season is 17 games: two seasons give a record of 8+ shared games, one season 4+. */
const MIN_SHARED = { both: 8, this: 4 };

function kickoff(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
}

/** The NFL parlay finder: the week's games and their lines, searched by the shared finder. */
export function NflParlayFinder({ slate }: { slate: Omit<NflPropsSlate, "logs"> & { logs: Record<string, PackedNflLog[]> } }) {
  const games = useMemo(
    () =>
      slate.games
        .filter((g) => slate.props.some((p) => p.quotes.length && slate.players[p.playerId]?.gameId === g.id))
        .map((g) => ({ id: g.id, away: g.away, home: g.home, start: kickoff(g.startUtc) })),
    [slate]
  );
  const logs = useMemo(() => Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackNflLog)])) as Record<string, NflLogPoint[]>, [slate.logs]);
  const legsFor = useCallback((gameId: string, shortestPrice: number) => nflFinderLegs(slate, logs, gameId, { shortestPrice }), [slate, logs]);
  return <ParlayFinder games={games} season={slate.season} legsFor={legsFor} minShared={MIN_SHARED} />;
}
