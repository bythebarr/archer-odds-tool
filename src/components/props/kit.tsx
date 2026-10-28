"use client";

/**
 * The player props layout every sport shares — NBA's, made into parts so NFL,
 * MLB, soccer and whatever comes next read identically: the sticky controls,
 * the game chips, the prop card, and the player sheet (header, line picker,
 * chart, projection, hit rates, matchup, every book, last 10 games).
 *
 * Each sport supplies only its numbers; the look lives here.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { formatAmerican, decimalToAmerican } from "@/lib/odds/americanOdds";
import { valueOf, type TwoSidedQuote } from "@/lib/odds/marketValue";
import type { BookRow } from "@/lib/nba/propsMath";
import type { PropDirection } from "@/lib/props/tally";
import { Logo } from "@/components/Logo";
import { BookBadge } from "@/components/BookBadge";
import { EvTag } from "@/components/EvTag";

export const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);

export function chip(active: boolean): string {
  return `shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
    active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
  }`;
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { key: T; label: string }[]; value: T; onChange: (key: T) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
            o.key === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const sideOptions = (labels: [string, string] = ["Over", "Under"]): { key: PropDirection; label: string }[] => [
  { key: "over", label: labels[0] },
  { key: "under", label: labels[1] },
];

// ── The finder ──────────────────────────────────────────────────────────────

/** Sticky controls: the stat strip, then side / sort / search. */
export function PropsControls<S extends string, O extends string>({
  stats,
  stat,
  onStat,
  side,
  onSide,
  sideLabels,
  sorts,
  sort,
  onSort,
  query,
  onQuery,
  placeholder = "Player",
}: {
  stats: { key: S; label: string; count?: number }[];
  stat: S;
  onStat: (s: S) => void;
  side: PropDirection;
  onSide: (s: PropDirection) => void;
  sideLabels?: [string, string];
  sorts: { key: O; label: string }[];
  sort: O;
  onSort: (s: O) => void;
  query: string;
  onQuery: (q: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="sticky top-[45px] z-10 -mx-4 mt-4 border-b border-border bg-background/90 px-4 pb-2.5 pt-2.5 backdrop-blur-md">
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]" role="tablist" aria-label="Stat">
        {stats.map((s) => (
          <button key={s.key} type="button" role="tab" aria-selected={s.key === stat} onClick={() => onStat(s.key)} className={chip(s.key === stat)}>
            {s.label}
            {s.count ? <span className={`ml-1 font-normal ${s.key === stat ? "opacity-70" : "opacity-60"}`}>{s.count}</span> : null}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Segmented options={sideOptions(sideLabels)} value={side} onChange={onSide} />
        <label className="relative shrink-0">
          <span className="sr-only">Sort</span>
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as O)}
            className="h-7 appearance-none rounded-lg bg-muted py-0 pl-2.5 pr-7 text-xs font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {sorts.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <svg viewBox="0 0 12 12" className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden>
            <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </label>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search players</span>
          <svg viewBox="0 0 16 16" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden>
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={placeholder}
            className="h-7 w-full rounded-lg bg-muted pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>
    </div>
  );
}

export interface ChipTeam {
  name: string;
  abbreviation: string;
  logoUrl: string | null;
  /** What the badge shows when there's no logo (defaults to the abbreviation). */
  mark?: string;
}

/** The game (or match) strip: "All games", then each matchup with its start. */
export function GameChips({
  games,
  active,
  onSelect,
  allLabel = "All games",
  separator = "@",
}: {
  games: { id: string; away: ChipTeam; home: ChipTeam; start: string; tag?: ReactNode }[];
  active: string | null;
  onSelect: (id: string | null) => void;
  allLabel?: string;
  separator?: string;
}) {
  if (games.length < 2) return null;
  return (
    <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      <button type="button" onClick={() => onSelect(null)} className={chip(active === null)}>
        {allLabel}
      </button>
      {games.map((g) => (
        <button key={g.id} type="button" onClick={() => onSelect(g.id === active ? null : g.id)} className={`${chip(g.id === active)} inline-flex items-center gap-1.5`}>
          <Logo sources={g.away.logoUrl ? [g.away.logoUrl] : []} alt={g.away.name} fallbackText={g.away.mark ?? g.away.abbreviation} size={16} />
          {g.away.abbreviation}
          <span className="opacity-50">{separator}</span>
          <Logo sources={g.home.logoUrl ? [g.home.logoUrl] : []} alt={g.home.name} fallbackText={g.home.mark ?? g.home.abbreviation} size={16} />
          {g.home.abbreviation}
          <span className="font-normal opacity-60">{g.start}</span>
          {g.tag}
        </button>
      ))}
    </div>
  );
}

/** The line above the list, and the heading where posted props end and ARCHR-only lines begin. */
export function ListNote({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-xs text-muted-foreground">{children}</p>;
}

export function ProjectedDivider() {
  return (
    <li className="mt-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      <span className="brand-slash" aria-hidden /> ARCHR lines · books haven&apos;t posted these yet
    </li>
  );
}

export function EmptyList({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The best price on a side, as the card shows it. */
export function BestPriceChip({ sideLabel, price, bookKey, bookName, edge = false }: { sideLabel: string; price: number; bookKey: string; bookName: string; edge?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 ring-1 ${edge ? "bg-brand text-brand-foreground ring-brand" : "bg-emerald-500/10 ring-emerald-500/30"}`}>
      <span className={`text-[10px] font-bold uppercase ${edge ? "" : "text-emerald-700 dark:text-emerald-300"}`}>{sideLabel}</span>
      <span className={`font-mono text-sm font-semibold ${edge ? "" : "text-foreground"}`}>{formatAmerican(price)}</span>
      <BookBadge bookKey={bookKey} bookName={bookName} size={18} />
    </span>
  );
}

/** Before books post: ARCHR's own line, with its chance and fair price when the sport prices it. */
export function ArchrLineChip({ label, price }: { label?: string; price?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand/10 px-2 py-1 ring-1 ring-brand/40" title="No book has posted this prop yet">
      <span className="text-[10px] font-bold uppercase text-foreground">{label ?? "ARCHR line"}</span>
      {price ? (
        <>
          <span className="font-mono text-sm font-semibold text-foreground">{price}</span>
          <span className="text-[9px] font-semibold uppercase text-muted-foreground">fair</span>
        </>
      ) : (
        <span className="text-[10px] text-muted-foreground">· books soon</span>
      )}
    </span>
  );
}

/** ARCHR's chance on the chosen side, volt when it sees an edge at the best price. */
export function ModelChip({ prob, edge }: { prob: number; edge: boolean }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 ${edge ? "bg-brand text-brand-foreground" : "bg-muted"}`}>
      <span className={`text-[10px] font-semibold uppercase ${edge ? "" : "text-muted-foreground"}`}>Model</span>
      <span className={`font-mono font-semibold ${edge ? "" : "text-foreground"}`}>{Math.round(prob * 100)}%</span>
    </span>
  );
}

/**
 * The prop card: headshot with team badge, name and matchup, the line with the
 * projection under it; the L10 meter with the price; a strip of splits with
 * the model and matchup chips.
 */
export function PropCard({
  onOpen,
  headshot,
  name,
  tag,
  badges,
  teamLogo,
  teamAbbr,
  sub,
  value,
  unit,
  under,
  meter,
  price,
  strip,
  stripRight,
  footer,
}: {
  onOpen: () => void;
  headshot: string[];
  name: string;
  /** After the name: position, batting order. */
  tag?: ReactNode;
  badges?: ReactNode;
  teamLogo?: string | null;
  teamAbbr?: string;
  sub: ReactNode;
  /** The big number on the right: the line, or a chance for yes/no props. */
  value: ReactNode;
  unit: ReactNode;
  under?: ReactNode;
  meter: ReactNode;
  price: ReactNode;
  strip?: ReactNode;
  stripRight?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group w-full rounded-2xl border border-border bg-card p-3.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            <Logo sources={headshot} alt={name} fallbackText={initials(name)} size={48} fit="cover" />
            {(teamLogo || teamAbbr) && (
              <span className="absolute -bottom-1 -right-1">
                <Logo sources={teamLogo ? [teamLogo] : []} alt={teamAbbr ?? ""} fallbackText={teamAbbr ?? ""} size={20} />
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight text-foreground">
              {name}
              {tag ? <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">{tag}</span> : null}
              {badges}
            </p>
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">{sub}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-xl font-semibold leading-none tracking-tight text-foreground">
              {value}
              <span className="ml-1 font-sans text-[10px] font-semibold text-muted-foreground">{unit}</span>
            </p>
            {under ? <p className="mt-1 text-[11px] text-muted-foreground">{under}</p> : null}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          {meter}
          <div className="flex items-center gap-1.5">{price}</div>
        </div>
        {(strip || stripRight) && (
          <div className="mt-2.5 flex items-center gap-3 overflow-x-auto whitespace-nowrap border-t border-border pt-2 text-[11px] text-muted-foreground [scrollbar-width:none]">
            {strip}
            <span className="ml-auto flex items-center gap-2">{stripRight}</span>
          </div>
        )}
        {footer}
      </button>
    </li>
  );
}

// ── The player sheet ────────────────────────────────────────────────────────

/** The sheet's frame: overlay, header (headshot, name, matchup), stat chips, a scrolling body. */
export function PlayerSheet({
  name,
  headshot,
  teamLogo,
  teamAbbr,
  tag,
  badges,
  sub,
  stats,
  stat,
  onStat,
  onClose,
  children,
}: {
  name: string;
  headshot: string[];
  teamLogo?: string | null;
  teamAbbr?: string;
  tag?: ReactNode;
  badges?: ReactNode;
  sub: ReactNode;
  stats: { key: string; label: string }[];
  stat: string;
  onStat: (key: string) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`${name} props`}>
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-in fade-in-0" onClick={onClose} />
      <div className="relative max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-background shadow-2xl animate-in slide-in-from-bottom-8 duration-200 sm:max-w-lg sm:rounded-2xl sm:slide-in-from-bottom-0 sm:zoom-in-95">
        <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 pb-3 pt-2 backdrop-blur">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30 sm:hidden" aria-hidden />
          <div className="flex items-center gap-3">
            <div className="relative">
              <Logo sources={headshot} alt={name} fallbackText={initials(name)} size={56} fit="cover" />
              {(teamLogo || teamAbbr) && (
                <span className="absolute -bottom-1 -right-1">
                  <Logo sources={teamLogo ? [teamLogo] : []} alt={teamAbbr ?? ""} fallbackText={teamAbbr ?? ""} size={22} />
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-foreground">
                {name}
                {tag ? <span className="ml-1.5 text-xs font-medium text-muted-foreground">{tag}</span> : null}
                {badges}
              </p>
              <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">{sub}</p>
            </div>
            <button ref={closeRef} type="button" onClick={onClose} className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
              <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {stats.length > 1 && (
            <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
              {stats.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => onStat(s.key)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    s.key === stat ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-5 px-4 pb-8 pt-4">{children}</div>
      </div>
    </div>
  );
}

/** The stat and its line, Over/Under, and every line on the ladder (posted or ARCHR's). */
export function LinePicker({
  label,
  value,
  side,
  onSide,
  sideLabels,
  ladder,
  point,
  onPoint,
}: {
  label: string;
  value: ReactNode;
  side: PropDirection;
  onSide: (s: PropDirection) => void;
  sideLabels?: [string, string];
  ladder: { point: number; main?: boolean; sub?: string }[];
  point: number;
  onPoint: (p: number) => void;
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="font-mono text-3xl font-semibold tracking-tight text-foreground">{value}</p>
        </div>
        <Segmented options={sideOptions(sideLabels)} value={side} onChange={onSide} />
      </div>
      {ladder.length > 1 && (
        <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]" aria-label="Lines">
          {ladder.map((l) => (
            <button
              key={l.point}
              type="button"
              onClick={() => onPoint(l.point)}
              className={`shrink-0 rounded-md border px-2.5 py-1 text-left transition-colors ${
                l.point === point ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="block font-mono text-xs font-semibold">
                {l.point}
                {l.main && <span className="ml-1 font-sans text-[9px] font-medium text-muted-foreground">MAIN</span>}
              </span>
              {l.sub ? <span className="block font-mono text-[10px] text-muted-foreground">{l.sub}</span> : null}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function ProjectedNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-brand/10 px-3 py-2 text-xs leading-relaxed text-foreground ring-1 ring-brand/30">{children}</p>;
}

/** A sheet section: the brand title (charts, projection) or the small caps one (tables). */
export function SheetSection({ title, brand = false, aside, children }: { title: ReactNode; brand?: boolean; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        {brand ? (
          <h3 className="flex items-center gap-2 font-display text-sm font-extrabold uppercase italic tracking-wide text-foreground">
            <span className="brand-slash" aria-hidden />
            {title}
          </h3>
        ) : (
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        )}
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Factor({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-1.5 text-center">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

/**
 * ARCHR's projection card: the number and its swing, each side's chance at
 * this line and the model EV, the sport's explanation lines, the factor grid,
 * and how it's built.
 */
export function ProjectionCard({
  headline,
  unit,
  swing,
  point,
  probOver,
  ev,
  sideLabels = ["O", "U"],
  children,
  factors,
  footnote,
}: {
  headline: string;
  unit: string;
  swing?: string;
  point: number;
  probOver: number;
  ev: number | null;
  sideLabels?: [string, string];
  children?: ReactNode;
  factors: { label: string; value: string }[];
  footnote: ReactNode;
}) {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <SheetSection title="ARCHR projection" brand>
      <div className="rounded-xl border border-border bg-card p-3.5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="font-mono text-3xl font-semibold leading-none tracking-tight text-foreground">
              {headline}
              <span className="ml-1 font-sans text-xs font-semibold text-muted-foreground">{unit}</span>
            </p>
            {swing && <p className="mt-1 text-[11px] text-muted-foreground">{swing}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">
              at {point}: <span className="font-mono font-semibold text-foreground">{sideLabels[0]} {pct(probOver)}</span> ·{" "}
              <span className="font-mono font-semibold text-foreground">{sideLabels[1]} {pct(1 - probOver)}</span>
            </p>
            {ev !== null && (
              <p className={`mt-1 font-mono text-sm font-bold ${ev >= 0.03 ? "text-emerald-600 dark:text-brand" : ev < 0 ? "text-muted-foreground" : "text-foreground"}`}>
                {ev >= 0 ? "+" : ""}
                {(ev * 100).toFixed(1)}% model EV
              </p>
            )}
          </div>
        </div>
        {children}
        {factors.length > 0 && (
          <div className={`mt-3 grid gap-1.5 ${factors.length >= 4 ? "grid-cols-4" : factors.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
            {factors.map((f) => (
              <Factor key={f.label} label={f.label} value={f.value} />
            ))}
          </div>
        )}
        <p className="mt-2.5 text-[10px] leading-relaxed text-muted-foreground">{footnote}</p>
      </div>
    </SheetSection>
  );
}

const fairOf = (p: number) => formatAmerican(Math.round(decimalToAmerican(1 / Math.min(0.995, Math.max(0.005, p)))));

/** Every book at this line: Best tagged, sharp books shown for reference, EV on the chosen side, the no-vig fair. */
export function BooksTable({
  point,
  books,
  pairs,
  side,
  bestBook,
  fairProbOver,
  projected,
  sideLabels = ["Over", "Under"],
}: {
  point: number;
  books: BookRow[];
  pairs: TwoSidedQuote[];
  side: PropDirection;
  bestBook: string | null | undefined;
  fairProbOver: number | null;
  projected: boolean;
  sideLabels?: [string, string];
}) {
  return (
    <SheetSection
      title={`Every book at ${point}`}
      aside={
        fairProbOver !== null ? (
          <span className="text-[11px] text-muted-foreground" title="The market's no-vig price: every book's two sides with the margin removed, averaged">
            Fair{" "}
            <span className="font-mono font-semibold text-foreground">
              {sideLabels[0][0]} {fairOf(fairProbOver)} · {sideLabels[1][0]} {fairOf(1 - fairProbOver)}
            </span>
          </span>
        ) : null
      }
    >
      {books.length === 0 ? (
        <p className="text-sm text-muted-foreground">{projected ? "Books haven't posted this prop yet — every book's price lands here when they do." : "No book prices this number."}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          <li className="grid grid-cols-[1fr_5.75rem_5.75rem] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>Book</span>
            <span className="text-right">{sideLabels[0]}</span>
            <span className="text-right">{sideLabels[1]}</span>
          </li>
          {books.map((b) => {
            const best = b.bookKey === bestBook;
            return (
              <li key={b.bookKey} className={`grid grid-cols-[1fr_5.75rem_5.75rem] items-center px-3 py-2 ${best ? "bg-emerald-500/10" : ""} ${b.bettable ? "" : "opacity-60"}`}>
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <BookBadge bookKey={b.bookKey} bookName={b.bookName} size={20} />
                  <span className="truncate">{b.bookName}</span>
                  {best && <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white dark:bg-emerald-500">Best</span>}
                  {!b.bettable && <span className="text-[10px] text-muted-foreground">sharp ref</span>}
                </span>
                {(["over", "under"] as const).map((s) => (
                  <span key={s} className={`flex items-center justify-end gap-1 text-right font-mono text-sm ${s === side ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                    {s === side && b[s] !== null && b.bettable && <EvTag value={valueOf(pairs, s === "over" ? "A" : "B", b[s]!, b.bookKey)} className="text-[9px]" />}
                    {b[s] === null ? "—" : formatAmerican(b[s]!)}
                  </span>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </SheetSection>
  );
}

export interface RecentRow {
  date: string;
  opponent: string;
  isHome: boolean;
  /** Minutes, snaps, PA, outs — whatever the sport's volume is. */
  volume?: number | string | null;
  value: number;
}

/** The last 10 games against this line: date, opponent, volume, the stat with ✓/✕. */
export function RecentGames({ rows, statShort, volumeLabel, point, side, title = "Last 10 games" }: { rows: RecentRow[]; statShort: string; volumeLabel?: string; point: number; side: PropDirection; title?: string }) {
  return (
    <SheetSection title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No games logged yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="pb-1 text-left font-medium">Date</th>
              <th className="pb-1 text-left font-medium">Opp</th>
              {volumeLabel && <th className="pb-1 text-right font-medium">{volumeLabel}</th>}
              <th className="pb-1 text-right font-medium">{statShort}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.slice(0, 10).map((g, i) => {
              const cashed = side === "over" ? g.value > point : g.value < point;
              return (
                <tr key={`${g.date}-${i}`}>
                  <td className="py-1.5 text-muted-foreground">{g.date.slice(5).replace("-", "/")}</td>
                  <td className="py-1.5">
                    {g.isHome ? "vs" : "@"} {g.opponent}
                  </td>
                  {volumeLabel && <td className="py-1.5 text-right font-mono text-muted-foreground">{g.volume ?? "—"}</td>}
                  <td className="py-1.5 text-right font-mono font-semibold">
                    <span className={cashed ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}>{g.value}</span>
                    <span className="ml-1 text-[10px] text-muted-foreground">{cashed ? "✓" : "✕"}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </SheetSection>
  );
}

export function SheetFooter() {
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      Hit rates are history, not a projection. Best price is among books you can bet; sharp reference books are shown for comparison only.
    </p>
  );
}

/** A compact matchup read for sports without a defense-vs-position table: label, the number, and how it reads. */
export function MatchupFacts({ rows }: { rows: { label: string; value: string; note?: string; tone?: "good" | "bad" | "neutral" }[] }) {
  if (!rows.length) return null;
  const tone = (t?: string) => (t === "good" ? "text-emerald-600 dark:text-emerald-400" : t === "bad" ? "text-red-600 dark:text-red-400" : "text-foreground");
  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span className="text-muted-foreground">{r.label}</span>
          <span className="text-right">
            <span className={`font-mono font-semibold ${tone(r.tone)}`}>{r.value}</span>
            {r.note ? <span className="block text-[10px] text-muted-foreground">{r.note}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
