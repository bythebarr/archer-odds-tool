"use client";

import { useState } from "react";
import type { GameWithLines } from "@/lib/queries/games";
import type { TeamHitRates } from "@/lib/queries/hitRate";
import type { ExpectedRuns } from "@/lib/archer/expectedRuns";
import { GamesScheduleView } from "./GamesScheduleView";
import { SlateLinesView } from "./SlateLinesView";

type MlbView = "games" | "lines";

interface MlbBoardProps {
  gamesWithLines: GameWithLines[];
  hitRatesByTeam: Record<string, TeamHitRates>;
  archerProbByGame: Record<string, { home: number | null; away: number | null } | null>;
  archerRunsByGame: Record<string, ExpectedRuns | null>;
}

/**
 * The MLB board with two lenses on the same day's odds:
 *  - "Games" (default): the schedule of clickable game cards, each previewing
 *    the best price per side and its book, linking into the full cross-book
 *    ladder at /games/[id]. Best odds up front, shop the rest on click-in.
 *  - "All lines": the flat, EV-sortable firehose of every book's line across
 *    every game — for when you want to scan the whole slate for edges at once.
 */
export function MlbBoard({ gamesWithLines, hitRatesByTeam, archerProbByGame, archerRunsByGame }: MlbBoardProps) {
  const [view, setView] = useState<MlbView>("games");

  return (
    <div>
      <div className="mb-4 flex justify-center">
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs font-medium">
          {(
            [
              { key: "games", label: "Games" },
              { key: "lines", label: "All lines" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setView(tab.key)}
              aria-pressed={view === tab.key}
              className={`rounded-md px-4 py-1.5 transition-colors ${
                view === tab.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {view === "games" ? (
        <GamesScheduleView gamesWithLines={gamesWithLines} />
      ) : (
        <SlateLinesView
          gamesWithLines={gamesWithLines}
          hitRatesByTeam={hitRatesByTeam}
          archerProbByGame={archerProbByGame}
          archerRunsByGame={archerRunsByGame}
        />
      )}
    </div>
  );
}
