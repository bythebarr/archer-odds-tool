"use client";

/**
 * Viewer-entered prop lines/prices, kept only in this browser (the same
 * "manual lines are not evidence" rule as `/nfl/research`): never sent to the
 * server, never stored as a market snapshot. Keyed by (event, market, player).
 */
import { useCallback, useEffect, useState } from "react";

export interface ManualLine {
  line: number | null;
  over: number | null;
  under: number | null;
}

const STORAGE_KEY = "archer-nfl-props-lines-v1";

export function manualKey(eventRef: string, market: string, playerId: string): string {
  return `${eventRef}|${market}|${playerId}`;
}

export function useManualLines() {
  const [lines, setLines] = useState<Record<string, ManualLine>>({});

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from browser storage
      if (raw) setLines(JSON.parse(raw) as Record<string, ManualLine>);
    } catch {
      /* storage unavailable — lines just won't persist */
    }
  }, []);

  const set = useCallback((key: string, next: ManualLine | null) => {
    setLines((prev) => {
      const copy = { ...prev };
      if (next === null) delete copy[key];
      else copy[key] = next;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
      } catch {
        /* ignore */
      }
      return copy;
    });
  }, []);

  return { lines, set };
}
