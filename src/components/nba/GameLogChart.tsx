"use client";

import { useState } from "react";
import type { GameLogPoint } from "@/lib/nba/propsMath";
import type { NbaPropStatDef } from "@/lib/nba/propStats";
import type { PropDirection } from "@/lib/props/tally";
import { HIT_FILL, MISS_FILL } from "./HitMeter";

const WIDTH = 340;
const HEIGHT = 150;
const PAD_TOP = 18;
const PAD_BOTTOM = 18;
const GAP = 3;
/** Right-hand gutter holding the line's label, so it never sits on a bar. */
const GUTTER = 30;
const PLOT_W = WIDTH - GUTTER;

function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/**
 * The last N games as bars against the line, oldest → newest. A bar is filled
 * when the chosen side cashed; the dashed rule is the line itself. Tapping (or
 * hovering) a bar shows that game in the readout above the plot.
 */
export function GameLogChart({
  logs,
  stat,
  point,
  side,
  count = 20,
}: {
  logs: GameLogPoint[];
  stat: NbaPropStatDef;
  point: number;
  side: PropDirection;
  count?: number;
}) {
  const games = logs.slice(0, count).reverse();
  const [active, setActive] = useState<number | null>(null);

  if (games.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No games logged yet.</p>;
  }

  const values = games.map((g) => stat.value(g));
  const max = Math.max(point, ...values) * 1.12 || 1;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const y = (v: number) => PAD_TOP + plotH - (v / max) * plotH;
  const barW = (PLOT_W - GAP * (Math.max(games.length, 10) - 1)) / Math.max(games.length, 10);
  const shown = active ?? games.length - 1;
  const g = games[shown];
  const v = values[shown];

  return (
    <div>
      <p className="mb-1 flex items-baseline justify-between text-xs text-muted-foreground">
        <span>
          {shortDate(g.date)} {g.isHome ? "vs" : "@"} {g.opponent} · {g.minutes} min
        </span>
        <span className="font-mono text-sm font-semibold text-foreground">
          {v} {stat.shortLabel}
        </span>
      </p>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`${stat.label}, last ${games.length} games against a line of ${point}`}
        onMouseLeave={() => setActive(null)}
      >
        {games.map((game, i) => {
          const value = values[i];
          const cashed = side === "over" ? value > point : value < point;
          const top = y(Math.max(value, 0.0001));
          const x = i * (barW + GAP);
          const h = PAD_TOP + plotH - top;
          return (
            <g
              key={`${game.date}-${i}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => setActive(i)}
              className="cursor-pointer"
            >
              {/* Hit target taller than the bar, so short bars are still easy to tap. */}
              <rect x={x} y={PAD_TOP} width={barW} height={plotH} fill="transparent" />
              {h >= 6 ? (
                <path
                  d={`M${x},${PAD_TOP + plotH} v${-(h - 3)} q0,-3 3,-3 h${barW - 6} q3,0 3,3 v${h - 3} z`}
                  className={`${cashed ? HIT_FILL : MISS_FILL} ${i === shown ? "opacity-100" : "opacity-80"}`}
                />
              ) : (
                // A zero (or near-zero) game still gets a visible stub on the baseline.
                <rect
                  x={x}
                  y={PAD_TOP + plotH - 2}
                  width={barW}
                  height={2}
                  className={`${cashed ? HIT_FILL : MISS_FILL} ${i === shown ? "opacity-100" : "opacity-80"}`}
                />
              )}
              {i === shown && (
                <text x={x + barW / 2} y={top - 4} textAnchor="middle" className="fill-foreground text-[10px] font-semibold">
                  {value}
                </text>
              )}
            </g>
          );
        })}
        <line
          x1={0}
          x2={PLOT_W}
          y1={y(point)}
          y2={y(point)}
          strokeDasharray="4 3"
          strokeWidth={1.5}
          className="stroke-foreground/70"
        />
        <text x={WIDTH} y={y(point) + 3.5} textAnchor="end" className="fill-muted-foreground text-[10px] font-semibold">
          {point}
        </text>
        <text x={0} y={HEIGHT - 4} className="fill-muted-foreground text-[10px]">
          {shortDate(games[0].date)}
        </text>
        <text x={PLOT_W} y={HEIGHT - 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
          Last game
        </text>
      </svg>
    </div>
  );
}
