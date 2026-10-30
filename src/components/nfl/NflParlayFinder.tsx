"use client";

import { useCallback, useMemo } from "react";
import { unpackNflLog, type NflLogPoint, type PackedNflLog } from "@/lib/nfl/propsMath";
import type { NflPropsSlate } from "@/lib/queries/nflProps";
import type { PostedLine } from "@/lib/queries/eventPropLines";
import { nflFinderLegs } from "@/lib/nfl/parlayLegs";
import { ParlayFinder } from "@/components/props/ParlayFinder";

/** A season is 17 games: two seasons give a record of 8+ shared games, one season 4+. */
const MIN_SHARED = { both: 8, this: 4 };

function kickoff(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
}

/** The NFL parlay finder: the week's games and their lines (priced or only posted), searched by the shared finder. */
export function NflParlayFinder({
  slate,
  posted,
}: {
  slate: Omit<NflPropsSlate, "logs"> & { logs: Record<string, PackedNflLog[]> };
  posted: Record<string, Record<string, PostedLine[]>>;
}) {
  const games = useMemo(
    () =>
      slate.games
        .filter((g) => Object.values(slate.players).some((p) => p.gameId === g.id && (posted[p.id] || slate.props.some((x) => x.playerId === p.id && x.quotes.length))))
        .map((g) => ({ id: g.id, away: g.away, home: g.home, start: kickoff(g.startUtc) })),
    [slate, posted]
  );
  const logs = useMemo(() => Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackNflLog)])) as Record<string, NflLogPoint[]>, [slate.logs]);
  const legsFor = useCallback((gameId: string, shortestPrice: number) => nflFinderLegs(slate, logs, gameId, { shortestPrice, posted }), [slate, logs, posted]);
  return <ParlayFinder games={games} season={slate.season} legsFor={legsFor} minShared={MIN_SHARED} />;
}
