/**
 * Confidence on the player sheet and the boards (lib/propModel/confidence):
 * the grade, and the reasons behind it, so a hit rate that looks good can be
 * read against everything the price is weighing. Plain components (no hooks).
 */
import Link from "next/link";
import { CONFIDENCE_TRACK_RECORD, CONFIDENCE_VALIDATED, gradeLabel, type CompactConfidence, type Confidence, type ConfidenceGrade } from "@/lib/propModel/confidence";

const GRADE_TONE: Record<ConfidenceGrade, string> = {
  A: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/40 dark:text-emerald-300",
  B: "bg-sky-500/15 text-sky-700 ring-sky-500/40 dark:text-sky-300",
  C: "bg-amber-500/15 text-amber-800 ring-amber-500/40 dark:text-amber-200",
  D: "bg-red-500/15 text-red-700 ring-red-500/40 dark:text-red-300",
};

const GRADE_WORDS: Record<ConfidenceGrade, string> = {
  A: "High: the read rests on solid ground",
  B: "Good: mostly solid, with a caveat or two",
  C: "Mixed: weigh the reasons below before trusting the number",
  D: "Low: too much here the model can't see or back up",
};


/** Shown with every grade while the grade is unvalidated. */
export const GRADES_NOT_VALIDATED = "grades not yet validated";

/**
 * The grade as a quiet marker on a line row: "B · 62", small and muted, with
 * a dotted underline while the grade is unvalidated. The factors behind it
 * live on the player sheet; the marker's tooltip names the top ones.
 */
export function ConfidenceMarker({ c }: { c: Confidence | CompactConfidence | null | undefined }) {
  if (!c) return null;
  const why = "why" in c ? c.why : null;
  const title = [`Confidence ${c.grade} · ${c.score} of 100`, CONFIDENCE_VALIDATED ? null : GRADES_NOT_VALIDATED, why].filter(Boolean).join(" — ");
  return (
    <span
      title={title}
      aria-label={title}
      className={`whitespace-nowrap font-mono text-[11px] font-semibold text-muted-foreground ${CONFIDENCE_VALIDATED ? "" : "underline decoration-dotted decoration-muted-foreground/60 underline-offset-[3px]"}`}
    >
      {c.grade} · {c.score}
    </span>
  );
}

/** The grade as a small chip (boards, leg rows). */
export function ConfidenceChip({ c }: { c: Confidence | CompactConfidence | null | undefined }) {
  if (!c) return <span className="font-mono text-[11px] text-muted-foreground">—</span>;
  const why = "why" in c ? c.why : null;
  const title = [`Confidence ${gradeLabel(c)} (score out of 100)`, why, CONFIDENCE_VALIDATED ? null : CONFIDENCE_TRACK_RECORD].filter(Boolean).join(" · ");
  return (
    <span title={title} className={`inline-flex min-w-6 items-center justify-center whitespace-nowrap rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold ring-1 ${GRADE_TONE[c.grade]}`}>
      {c.grade} <span className="ml-1 font-semibold opacity-80">{c.score}</span>
    </span>
  );
}

/** A reason behind the price, from the projection's own inputs: for the bet, against it, or context. */
export interface PriceReason {
  text: string;
  supports: boolean | null;
}

/**
 * The sheet's panel: the grade with what it means, every factor that moved
 * it (and the ones that didn't, as context), and what the projection itself
 * weighed — the minutes, the matchup, the game script, the form.
 */
export function ConfidencePanel({ c, reasons = [], sideLabel }: { c: Confidence | null; reasons?: PriceReason[]; sideLabel: string }) {
  if (!c) return null;
  const moved = c.factors.filter((f) => f.effect !== 0).sort((a, b) => b.effect - a.effect);
  const context = c.factors.filter((f) => f.effect === 0);
  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        <span
          aria-label={`Confidence ${gradeLabel(c)}`}
          className={`inline-flex h-11 shrink-0 items-baseline justify-center gap-1 rounded-xl px-2.5 pt-1.5 font-display font-extrabold ring-1 ${GRADE_TONE[c.grade]}`}
        >
          <span className="text-2xl leading-none">{c.grade}</span>
          <span className="text-base leading-none opacity-80">{c.score}</span>
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Confidence · {sideLabel}</p>
          <p className="text-sm font-semibold text-foreground">{GRADE_WORDS[c.grade]}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Score out of 100: how far to trust ARCHR&apos;s chance and edge on this bet, not a chance itself.
          </p>
          {!CONFIDENCE_VALIDATED && (
            <p className="mt-1 text-[10px] text-muted-foreground">Track record: {CONFIDENCE_TRACK_RECORD}</p>
          )}
        </div>
      </div>

      {moved.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-xs">
          {moved.map((f) => (
            <li key={f.key} className="flex gap-2">
              <span className={`w-8 shrink-0 text-right font-mono font-semibold ${f.effect > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-700 dark:text-amber-300"}`}>
                {f.effect > 0 ? "+" : "−"}
                {Math.abs(f.effect)}
              </span>
              <span className="text-foreground">{f.text}</span>
            </li>
          ))}
        </ul>
      )}
      {context.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          {context.map((f) => (
            <li key={f.key} className="flex gap-2">
              <span className="w-8 shrink-0 text-right">•</span>
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
      )}

      {reasons.length > 0 && (
        <div className="mt-3 border-t border-border pt-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What the projection weighed</p>
          <ul className="mt-1.5 space-y-1 text-xs">
            {reasons.map((r) => (
              <li key={r.text} className="flex gap-2">
                <span
                  aria-hidden
                  className={`w-8 shrink-0 text-right font-bold ${
                    r.supports === null ? "text-muted-foreground" : r.supports ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {r.supports === null ? "•" : r.supports ? "▲" : "▼"}
                </span>
                <span className={r.supports === null ? "text-muted-foreground" : "text-foreground"}>{r.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10px] text-muted-foreground">▲ for this side · ▼ against · • context</p>
        </div>
      )}
      <p className="mt-2.5 text-[10px] text-muted-foreground">
        Graded from the stat&apos;s report card, his history, whether his record backs the price, how far ARCHR sits from the books, his minutes, injury tags
        and the line.{" "}
        <Link href="/models" className="font-semibold text-foreground underline-offset-2 hover:underline">
          How the models grade
        </Link>
      </p>
    </section>
  );
}
