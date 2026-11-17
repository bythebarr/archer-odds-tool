/**
 * Tonight's NBA research board — every main-line prop's experimental read and
 * market value (lib/shadow/capture nbaValueBoard over lib/shadow/marketValue)
 * — built once and cached five minutes. The one source for both the research
 * page (/nba/research) and the NBA screener's research mode, so the two always
 * show the same v2, s2, no-vig and EV for the same prop, side, line and price.
 * Server-only; read-only (it records nothing — the capture does that).
 */
import { unstable_cache } from "next/cache";
import { getNbaPropsSlate, toWireSlate } from "@/lib/queries/nbaProps";
import { unpackLog, type GameLogPoint } from "@/lib/nba/propsMath";
import { nbaShadowRows, nbaValueBoard } from "./capture";
import { nbaQuoteAges } from "./quoteAges";
import type { ValueRow } from "./marketValue";

export interface ResearchBoard {
  values: ValueRow[];
  /** The frozen rule's picks ("rowId|side"), in rank order. */
  candidates: string[];
  computedAt: string;
  books: string[];
}

export const getNbaResearchBoard = unstable_cache(
  async (date: string): Promise<ResearchBoard> => {
    const slate = toWireSlate(await getNbaPropsSlate(date));
    const logs = Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackLog)])) as Record<string, GameLogPoint[]>;
    const now = new Date();
    const upcoming = new Set(slate.games.filter((g) => new Date(g.startUtc) > now).map((g) => g.id));
    const ages = await nbaQuoteAges([...upcoming]);
    const board = nbaValueBoard(slate, nbaShadowRows(slate, logs, upcoming), ages, now);
    const books = [...new Set(slate.props.flatMap((p) => p.quotes.map((q) => q.bookName)))].sort();
    return { values: board.values, candidates: board.candidates, computedAt: now.toISOString(), books };
  },
  ["nba-research-board-v2"],
  { revalidate: 300 }
);
