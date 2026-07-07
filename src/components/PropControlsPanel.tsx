"use client";

import { useEffect, useRef, useState } from "react";
import type { StatCategory, Handedness } from "@/generated/prisma/client";
import type { PropHitRateSplits } from "@/lib/props/hitRate";
import { STAT_CATEGORY_LABELS, STAT_CATEGORY_DEFAULT_LINE } from "@/lib/props/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PropHitRateSplitsCard } from "@/components/PropHitRateSplitsCard";

const STAT_CATEGORY_OPTIONS = Object.keys(STAT_CATEGORY_LABELS) as StatCategory[];

interface PropControlsPanelProps {
  mlbPlayerId: string;
  initialStatCategory: StatCategory;
  initialLine: number;
  initialDirection: "over" | "under";
  initialSplits: PropHitRateSplits;
  highlightHand?: Handedness | null;
}

export function PropControlsPanel({
  mlbPlayerId,
  initialStatCategory,
  initialLine,
  initialDirection,
  initialSplits,
  highlightHand,
}: PropControlsPanelProps) {
  const [statCategory, setStatCategory] = useState(initialStatCategory);
  const [line, setLine] = useState(initialLine);
  const [direction, setDirection] = useState(initialDirection);
  const [splits, setSplits] = useState(initialSplits);
  const [loading, setLoading] = useState(false);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // The server already computed initialSplits for this exact combo — skip
    // the redundant round-trip on mount, only fetch on subsequent changes.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    fetch(
      `/api/props/${mlbPlayerId}/hit-rate?statCategory=${statCategory}&line=${line}&direction=${direction}`,
      { signal: controller.signal }
    )
      .then((r) => r.json())
      .then((data: { splits: PropHitRateSplits }) => setSplits(data.splits))
      .catch(() => {})
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [mlbPlayerId, statCategory, line, direction]);

  return (
    <>
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <Select
          value={statCategory}
          onValueChange={(v) => {
            const next = v as StatCategory;
            setStatCategory(next);
            setLine(STAT_CATEGORY_DEFAULT_LINE[next]);
          }}
        >
          <SelectTrigger>
            <SelectValue>{(value: StatCategory) => STAT_CATEGORY_LABELS[value]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STAT_CATEGORY_OPTIONS.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {STAT_CATEGORY_LABELS[cat]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="number"
          step={0.5}
          value={line}
          onChange={(e) => setLine(Number(e.target.value))}
          className="w-20"
        />

        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={direction === "over" ? "default" : "outline"}
            onClick={() => setDirection("over")}
          >
            Over
          </Button>
          <Button
            type="button"
            size="sm"
            variant={direction === "under" ? "default" : "outline"}
            onClick={() => setDirection("under")}
          >
            Under
          </Button>
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <PropHitRateSplitsCard
            splits={splits}
            line={line}
            direction={direction}
            statLabel={STAT_CATEGORY_LABELS[statCategory]}
            highlightHand={highlightHand}
          />
        )}
      </div>
    </>
  );
}
