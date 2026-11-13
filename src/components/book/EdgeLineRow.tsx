import Link from "next/link";
import type { ReactNode } from "react";
import { formatAmerican } from "@/lib/odds/americanOdds";
import type { CompactConfidence, Confidence } from "@/lib/propModel/confidence";
import { BookBadge } from "@/components/BookBadge";
import { ConfidenceMarker } from "@/components/props/ConfidencePanel";

/**
 * One line, edge first. Left to right: the edge, big; then what the bet is,
 * with ARCHR chance and the best price under it; then a quiet confidence
 * marker. One number at rest: everything else (record, minutes, injury, alt
 * rung, gap to the books, the factor list) lives on the player sheet.
 *
 * `edgeBasis` says what the edge is measured against: ARCHR's chance (the
 * default) or, on market-only rows, the books' own no-vig fair price, which
 * the whisper names so the two are never read as one number.
 *
 * `frozen` greys the edge and dates it ("Prices from Nov 1"): a number from a
 * feed that isn't updating is history, never shown as live.
 *
 * Plain component (no hooks), usable from server and client trees.
 */
export interface EdgeLineRowProps {
  /** What the bet is: "LeBron James Over 26.5 PTS". */
  label: ReactNode;
  /** A small logo or avatar before the edge. */
  leading?: ReactNode;
  /** ARCHR edge (or the market EV on market-only rows) as a fraction; null when there's nothing to measure. */
  edge: number | null;
  edgeBasis?: "archr" | "market";
  /** The chance beside the price, with its own name ("ARCHR", "Fair", "Hit-rate proj."). */
  chance?: { label: string; value: number | null } | null;
  price?: number | null;
  /** The book with the best price; without a key its name shows as text. */
  book?: { key?: string; name: string } | null;
  confidence?: Confidence | CompactConfidence | null;
  frozen?: { asOf: string } | null;
  /** Provenance and context, one quiet line: "PHI @ BOS · 7:30 PM · Marginal · 412 graded". */
  whisper?: ReactNode;
  href?: string;
  /** A trailing control (add to slip). */
  action?: ReactNode;
  className?: string;
}

/** The edge's colour: by sign, then by size. Greyed when frozen. */
export function edgeTone(edge: number | null, frozen: boolean): string {
  if (frozen || edge === null) return "text-muted-foreground/70";
  if (edge >= 0.05) return "text-emerald-600 dark:text-emerald-400";
  if (edge >= 0.02) return "text-emerald-700/85 dark:text-emerald-300/85";
  if (edge >= 0) return "text-foreground";
  return "text-muted-foreground";
}

export function formatEdge(edge: number | null): string {
  if (edge === null) return "—";
  const v = edge * 100;
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function EdgeLineRow({ label, leading, edge, edgeBasis = "archr", chance, price, book, confidence, frozen, whisper, href, action, className = "" }: EdgeLineRowProps) {
  const isFrozen = Boolean(frozen);
  const numbers: ReactNode[] = [];
  if (chance) numbers.push(<span key="c">{chance.label} {chance.value === null ? "—" : pct(chance.value)}</span>);
  if (price != null)
    numbers.push(
      <span key="p" className="inline-flex items-center gap-1">
        <span className="font-mono font-semibold text-foreground">{formatAmerican(price)}</span>
        {book && (book.key ? <BookBadge bookKey={book.key} bookName={book.name} size={13} /> : <span className="text-[11px]">{book.name}</span>)}
      </span>
    );
  const whispers: ReactNode[] = [];
  if (isFrozen) whispers.push(<span key="f">Prices from {frozen!.asOf}</span>);
  if (edgeBasis === "market" && edge !== null) whispers.push(<span key="m">edge vs the market&apos;s fair price</span>);
  if (whisper) whispers.push(<span key="w">{whisper}</span>);

  const body = (
    <>
      {leading && <span className="mt-0.5 shrink-0">{leading}</span>}
      <span className="w-[4.25rem] shrink-0 sm:w-[4.75rem]">
        <span className={`block font-mono text-[19px] font-extrabold leading-none tabular-nums tracking-tight sm:text-[21px] ${edgeTone(edge, isFrozen)}`} title={isFrozen ? `Prices from ${frozen!.asOf}: not live` : undefined}>
          {formatEdge(edge)}
        </span>
        <span className="mt-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">{isFrozen ? `from ${frozen!.asOf}` : "edge"}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold leading-snug text-foreground">{label}</span>
        {numbers.length > 0 && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
            {numbers.flatMap((n, i) => (i ? [<span key={`s${i}`} aria-hidden>·</span>, n] : [n]))}
          </span>
        )}
        {whispers.length > 0 && (
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/75">
            {whispers.flatMap((w, i) => (i ? [" · ", w] : [w]))}
          </span>
        )}
      </span>
      {confidence && (
        <span className="mt-0.5 shrink-0">
          <ConfidenceMarker c={confidence} />
        </span>
      )}
    </>
  );

  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 ${className}`}>
      {href ? (
        <Link href={href} className="flex min-w-0 flex-1 items-start gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {body}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-3">{body}</div>
      )}
      {action && <span className="shrink-0 self-center">{action}</span>}
    </div>
  );
}

/** A list of edge rows with hairline dividers, in one card. */
export function EdgeLineList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`divide-y divide-border overflow-hidden rounded-xl border border-border bg-card ${className}`}>{children}</div>;
}
