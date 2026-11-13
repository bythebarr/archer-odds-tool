import type { BoardGradeCounts } from "@/lib/propModel/confidenceDiagnosis";

/** Tonight's board by Confidence grade (main lines), with what an A needs. */
export function BoardGradesLine({ board }: { board: { sport: string; counts: BoardGradeCounts }[] }) {
  if (!board.length) return null;
  return (
    <p className="mt-4 rounded-xl border border-border bg-card px-3 py-2.5 text-xs leading-relaxed text-muted-foreground" data-testid="board-grades">
      <span className="font-semibold text-foreground">Confidence on tonight&apos;s board</span> (main lines, as graded on the screener):{" "}
      {board.map((b, i) => (
        <span key={b.sport} className="whitespace-nowrap font-mono tabular-nums text-foreground">
          {i > 0 && " · "}
          {b.sport.toUpperCase()} A {b.counts.A} · B {b.counts.B} · C {b.counts.C} · D {b.counts.D}
        </span>
      ))}
      . An A (75+) needs a stat whose report card above has passed; without one, the most a prop can score is 70.
    </p>
  );
}
