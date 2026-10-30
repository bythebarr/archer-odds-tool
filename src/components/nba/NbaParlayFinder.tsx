"use client";

import { useCallback, useMemo } from "react";
import { unpackLog, type GameLogPoint } from "@/lib/nba/propsMath";
import type { WireNbaPropsSlate } from "@/lib/queries/nbaProps";
import { nbaFinderLegs } from "@/lib/nba/parlayLegs";
import { ParlayFinder } from "@/components/props/ParlayFinder";

/** Shared games a record needs: over two seasons, and this season only. */
const MIN_SHARED = { both: 10, this: 4 };

function startLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
}

/** The NBA parlay finder: tonight's games and their lines, searched by the shared finder. */
export function NbaParlayFinder({ slate }: { slate: WireNbaPropsSlate }) {
  const games = useMemo(
    () =>
      slate.games
        .filter((g) => slate.props.some((p) => slate.players[p.playerId]?.gameId === g.id))
        .map((g) => ({ id: g.id, away: g.away, home: g.home, start: startLabel(g.startUtc) })),
    [slate]
  );
  const logs = useMemo(
    () => Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackLog)])) as Record<string, GameLogPoint[]>,
    [slate.logs]
  );
  const legsFor = useCallback((gameId: string, shortestPrice: number) => nbaFinderLegs(slate, logs, gameId, { shortestPrice }), [slate, logs]);
  return <ParlayFinder games={games} season={slate.season} legsFor={legsFor} minShared={MIN_SHARED} />;
}
