"use client";

import { useSyncExternalStore } from "react";

// A tick source that re-renders on the minute without setState-in-effect (this
// repo lints that pattern out). getSnapshot is quantized to the minute so React
// gets a stable value within a render; the server snapshot is null so the first
// paint matches SSR, then hydration fills in the real time.
function subscribe(onChange: () => void): () => void {
  const id = setInterval(onChange, 30_000);
  return () => clearInterval(id);
}
function useMinuteNow(): number | null {
  const minute = useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / 60_000),
    () => null,
  );
  return minute == null ? null : minute * 60_000;
}

/**
 * A live "lights out in Dd HHh MMm" countdown to the next Grand Prix. Renders a
 * placeholder until hydrated (so server/client agree on "now"), then ticks each
 * minute — F1 races are days out, so second-precision is just churn.
 */
export function RaceCountdown({ targetIso }: { targetIso: string }) {
  const now = useMinuteNow();
  const target = new Date(targetIso).getTime();
  const diff = now == null ? 0 : target - now;
  const started = now != null && diff <= 0;

  const totalMinutes = Math.max(0, Math.floor(diff / 60_000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  return (
    <div className="shrink-0 text-right">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {started ? "Underway" : "Lights out in"}
      </div>
      <div className="font-mono text-lg font-bold tabular-nums text-foreground" suppressHydrationWarning>
        {now == null || started ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <>
            {days > 0 ? <span>{days}d </span> : null}
            {hours}h {minutes}m
          </>
        )}
      </div>
    </div>
  );
}
