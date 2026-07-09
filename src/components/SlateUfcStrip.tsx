import Link from "next/link";
import type { SlateItem } from "@/lib/queries/slate";
import type { FinishMethod } from "@/lib/ufc/finishMath";
import { FighterBadge } from "./FighterBadge";

/** Compact "how it ends" label + accent, matching the bout page's finish card and the old Lines board. */
const METHOD_LEAN_META: Record<FinishMethod, { label: string; color: string }> = {
  ko: { label: "KO/TKO", color: "#ea580c" },
  submission: { label: "Sub", color: "#7c3aed" },
  decision: { label: "Dec", color: "#64748b" },
};

/** Surname (last name token) — UFC's `meta` is a W-L record, not a short id, so the name's last token is the compact label. */
function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1];
}

/** The model's favored fighter + probability for a bout, or null if unmodeled. home = red/fighterA, away = blue/fighterB. */
function favored(item: SlateItem): { side: SlateItem["home"]; prob: number } | null {
  const home = item.modelProb?.home;
  const away = item.modelProb?.away;
  if (home === null || home === undefined || away === null || away === undefined) return null;
  return home >= away ? { side: item.home, prob: home } : { side: item.away, prob: away };
}

function UfcRow({ item }: { item: SlateItem }) {
  const fav = favored(item);
  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-accent/50"
    >
      <span className="flex shrink-0 items-center -space-x-1.5">
        <FighterBadge name={item.away.name} imageUrl={item.away.imageUrl} size={22} />
        <FighterBadge name={item.home.name} imageUrl={item.home.imageUrl} size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-foreground">
          <span className="font-medium">{item.away.name}</span>
          <span className="text-xs text-muted-foreground">vs</span>
          <span className="font-medium">{item.home.name}</span>
        </span>
        {item.methodLean ? (
          <span className="block truncate text-[11px]" style={{ color: METHOD_LEAN_META[item.methodLean.method].color }}>
            {METHOD_LEAN_META[item.methodLean.method].label} {Math.round(item.methodLean.pct * 100)}%
          </span>
        ) : null}
      </span>
      <span className="w-24 shrink-0 text-right">
        {fav ? (
          <span className="whitespace-nowrap font-mono text-xs text-foreground">
            {surname(fav.side.name)} <span className="text-muted-foreground">{Math.round(fav.prob * 100)}%</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/60">—</span>
        )}
      </span>
    </Link>
  );
}

/**
 * A compact UFC card on the Slate. UFC has no book prices, so it can't be a row
 * in the priced Value pool — but it's the flagship's most-loved sport, so it
 * rides alongside the pool as its own strip: the model's favored fighter + the
 * finish-method lean per bout, each linking to the full bout projection.
 */
export function SlateUfcStrip({ items }: { items: SlateItem[] }) {
  if (items.length === 0) return null;

  const eventTitle = items.find((i) => i.title)?.title ?? null;

  return (
    <section className="mb-8 rounded-xl border border-border bg-card/40 p-3">
      <div className="flex items-baseline justify-between gap-2 px-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <span aria-hidden>🥊</span> UFC {eventTitle ? <span className="font-normal text-muted-foreground">· {eventTitle}</span> : null}
        </h2>
        <Link href="/ufc" className="shrink-0 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline">
          Full card →
        </Link>
      </div>
      <p className="px-2 pt-0.5 text-[11px] text-muted-foreground/70">
        Model favorite + finish lean — no book prices yet. Tap a bout for the full projection.
      </p>
      <div className="mt-2 divide-y divide-border/50">
        {items.map((item) => (
          <UfcRow key={item.key} item={item} />
        ))}
      </div>
    </section>
  );
}
