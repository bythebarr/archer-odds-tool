/**
 * The matchup breakdown every sport's event page is built from, so a game, a
 * fight or a match all read the same way: the face-off, ARCHR's price against
 * the book's, the tale of the tape, and why ARCHR prices it the way it does.
 * Server-safe (no state); sport pages supply the numbers.
 */
import type { ReactNode } from "react";
import { BookBadge } from "@/components/BookBadge";
import { formatAmerican } from "@/lib/odds/americanOdds";

export const SIDE_A_COLOR = "#e11d48";
export const SIDE_B_COLOR = "#2563eb";

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h2 className="flex items-center gap-2 font-display text-sm font-extrabold uppercase italic tracking-wide text-foreground">
        <span className="brand-slash" aria-hidden />
        {children}
      </h2>
      {aside}
    </div>
  );
}

export interface FaceOffSide {
  name: string;
  /** Under the name: a record, a team, a nickname. */
  sub?: string | null;
  /** The badge: a logo or a headshot. */
  badge: ReactNode;
  color: string;
}

/**
 * The face-off: always ink, the two sides squared up over ARCHR's win chance.
 * `chips` sit above (title fight, main event, rivalry), `meta` under them.
 */
export function FaceOff({
  a,
  b,
  probA,
  draw = null,
  probLabel = "ARCHR win probability",
  chips,
  meta,
  center = "VS",
  footer,
}: {
  a: FaceOffSide;
  b: FaceOffSide;
  probA: number | null;
  /** A three-way market's draw: the two sides then show their own chances, and the bar a gray draw share. */
  draw?: number | null;
  probLabel?: string;
  chips?: ReactNode;
  meta?: ReactNode;
  center?: ReactNode;
  footer?: ReactNode;
}) {
  const probB = probA === null ? null : 1 - probA - (draw ?? 0);
  const side = (s: FaceOffSide, prob: number | null) => (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
      <span className="rounded-full p-[3px]" style={{ background: s.color }}>
        <span className="block rounded-full bg-[#07080b] p-1">{s.badge}</span>
      </span>
      <span className="mt-1 w-full truncate text-[15px] font-semibold">{s.name}</span>
      {s.sub ? <span className="w-full truncate font-mono text-xs text-[#8a90a0]">{s.sub}</span> : null}
      {prob !== null && <span className="mt-1 font-display text-2xl font-extrabold italic leading-none">{Math.round(prob * 100)}%</span>}
    </div>
  );
  return (
    <div className="relative mt-3 overflow-hidden rounded-2xl bg-[#07080b] bg-[radial-gradient(110%_90%_at_50%_120%,rgba(200,245,58,0.14),transparent_60%)] px-4 pb-5 pt-4 text-[#eef0f4] ring-1 ring-white/10">
      {chips ? <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide">{chips}</div> : null}
      {meta ? <p className="mt-1 text-center text-[11px] text-[#8a90a0]">{meta}</p> : null}
      <div className="mt-4 flex items-start justify-between gap-2">
        {side(a, probA)}
        <span className="mt-9 shrink-0 text-center font-display text-xl font-extrabold italic text-[#c8f53a]">{center}</span>
        {side(b, probB)}
      </div>
      {probA !== null && (
        <div className="mt-3">
          <div className="flex h-1.5 overflow-hidden rounded-full" aria-hidden>
            <span style={{ width: `${probA * 100}%`, background: a.color }} />
            {draw ? <span style={{ width: `${draw * 100}%` }} className="bg-[#3a3f4b]" /> : null}
            <span className="flex-1" style={{ background: b.color }} />
          </div>
          <p className="mt-1.5 text-center text-[10px] uppercase tracking-wide text-[#8a90a0]">{probLabel}</p>
        </div>
      )}
      {footer ? <div className="mt-4 border-t border-white/10 pt-3 text-center text-sm">{footer}</div> : null}
    </div>
  );
}

export interface ValueRow {
  /** "Spread", "Total", "Moneyline". */
  market: string;
  /** The side ARCHR prefers, e.g. "Celtics +4.5". */
  pick: string;
  /** ARCHR's fair price for that side (American), or a fair line ("BOS −3.5"). */
  fair: string;
  /** The best book price on that side. */
  best: { priceAmerican: number; bookKey: string; bookName: string } | null;
  /** The book's own line when it differs from ARCHR's (spreads/totals). */
  bookLine?: string | null;
  /** EV of the best price at ARCHR's chance. */
  edge: number | null;
}

/** Edge worth calling out: clear of line-timing noise after the market blend. */
const EDGE = 0.02;

function verdict(edge: number | null, priced: boolean): { text: string; tone: string } {
  if (edge === null) return { text: priced ? "No read" : "No book yet", tone: "text-muted-foreground" };
  if (edge >= 0.05) return { text: "Strong value", tone: "text-emerald-500 dark:text-brand" };
  if (edge >= EDGE) return { text: "Value", tone: "text-emerald-600 dark:text-brand" };
  if (edge >= -0.02) return { text: "Fair", tone: "text-foreground" };
  return { text: "Overpriced", tone: "text-muted-foreground" };
}

/**
 * ARCHR vs the book — the namesake read, edge first: for each market, the side
 * ARCHR likes, its fair price next to the best book's, and the edge.
 */
export function ValueStrip({ rows, footnote }: { rows: ValueRow[]; footnote?: ReactNode }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-6">
      <SectionTitle>ARCHR vs the book</SectionTitle>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-[minmax(0,1fr)_4.25rem_5.5rem_3.75rem] items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Pick</span>
          <span className="text-right">ARCHR</span>
          <span className="text-right">Best book</span>
          <span className="text-right">Edge</span>
        </div>
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const v = verdict(r.edge, r.best !== null);
            return (
              <li key={r.market} className="grid grid-cols-[minmax(0,1fr)_4.25rem_5.5rem_3.75rem] items-center gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{r.market}</p>
                  <p className="truncate text-sm font-semibold text-foreground">{r.pick}</p>
                  <p className={`text-[11px] font-semibold ${v.tone}`}>{v.text}</p>
                </div>
                <span className="text-right font-mono text-sm font-semibold text-foreground">{r.fair}</span>
                <span className="flex items-center justify-end gap-1.5">
                  {r.best ? (
                    <>
                      <span className="text-right">
                        <span className="block font-mono text-sm font-semibold text-foreground">{formatAmerican(r.best.priceAmerican)}</span>
                        {r.bookLine ? <span className="block font-mono text-[10px] text-muted-foreground">{r.bookLine}</span> : null}
                      </span>
                      <BookBadge bookKey={r.best.bookKey} bookName={r.best.bookName} size={18} />
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </span>
                <span
                  className={`justify-self-end rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold ${
                    r.edge !== null && r.edge >= EDGE ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {r.edge === null ? "—" : `${r.edge >= 0 ? "+" : ""}${(r.edge * 100).toFixed(1)}%`}
                </span>
              </li>
            );
          })}
        </ul>
        {footnote ? <p className="border-t border-border px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">{footnote}</p> : null}
      </div>
    </section>
  );
}

export interface TapeRowData {
  label: string;
  a: string;
  b: string;
  /** Which side the row favors, when it's a real edge. */
  edge?: "a" | "b" | null;
}

/** Tale of the tape: side A's value, the label, side B's value — the edge side bolded and tinted. */
export function TaleOfTape({ rows, a, b, title = "Tale of the tape" }: { rows: TapeRowData[]; a: { label: string; color: string }; b: { label: string; color: string }; title?: string }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-6">
      <SectionTitle>{title}</SectionTitle>
      <div className="rounded-xl border border-border bg-card px-3.5">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 border-b border-border py-2 text-[10px] font-bold uppercase tracking-wide">
          <span style={{ color: a.color }}>{a.label}</span>
          <span />
          <span className="text-right" style={{ color: b.color }}>
            {b.label}
          </span>
        </div>
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <div key={r.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2.5 text-sm">
              <span className={`text-left font-mono ${r.edge === "a" ? "font-bold text-foreground" : "text-foreground/70"}`}>
                {r.edge === "a" && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: a.color }} />}
                {r.a}
              </span>
              <span className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{r.label}</span>
              <span className={`text-right font-mono ${r.edge === "b" ? "font-bold text-foreground" : "text-foreground/70"}`}>
                {r.b}
                {r.edge === "b" && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: b.color }} />}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export interface Factor {
  label: string;
  /** Signed push: positive favors side A, negative side B. */
  value: number;
  /** How the push reads, e.g. "+3.2 pts". */
  display: string;
}

/** Why ARCHR prices it this way: each factor's push toward one side, as a bar. */
export function WhyPanel({ factors, a, b, footnote }: { factors: Factor[]; a: { label: string; color: string }; b: { label: string; color: string }; footnote?: ReactNode }) {
  // Pushes under a tenth of the scale read as zero and stay off the chart.
  const shown = factors.filter((f) => Math.abs(f.value) >= 0.05);
  if (shown.length === 0) return null;
  const max = Math.max(...shown.map((f) => Math.abs(f.value)));
  return (
    <section className="mt-6">
      <SectionTitle>Why ARCHR prices it this way</SectionTitle>
      <div className="rounded-xl border border-border bg-card p-3.5">
        <div className="mb-2 flex justify-between text-[10px] font-bold uppercase tracking-wide">
          <span style={{ color: a.color }}>Favors {a.label}</span>
          <span style={{ color: b.color }}>Favors {b.label}</span>
        </div>
        <ul className="space-y-2">
          {shown.map((f) => {
            const w = `${(Math.abs(f.value) / max) * 100}%`;
            return (
              <li key={f.label} className="grid grid-cols-[1fr_7.5rem_1fr] items-center gap-2 text-[11px]">
                <div className="flex justify-end">{f.value > 0 && <span className="h-2 rounded-l-full" style={{ width: w, background: a.color }} />}</div>
                <span className="text-center leading-tight text-muted-foreground">
                  {f.label}
                  <span className="block font-mono font-semibold text-foreground">{f.display}</span>
                </span>
                <div>{f.value < 0 && <span className="block h-2 rounded-r-full" style={{ width: w, background: b.color }} />}</div>
              </li>
            );
          })}
        </ul>
        {footnote ? <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">{footnote}</p> : null}
      </div>
    </section>
  );
}
