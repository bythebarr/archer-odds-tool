import type { ScreenerProp } from "@/lib/screener/types";
import { propHref } from "@/lib/screener/types";
import type { FrozenPrices } from "@/lib/queries/oddsFeed";
import { EdgeLineRow } from "@/components/book/EdgeLineRow";

function sideText(p: ScreenerProp): string {
  if (p.side === "yes") return `${p.statLabel} Yes`;
  return `${p.side === "over" ? "Over" : "Under"} ${p.point} ${p.statLabel}`;
}

function startLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
}

/**
 * A screener prop as an edge row: ARCHR edge first, then the prop with ARCHR
 * chance and the best price, then the quiet confidence marker. The record,
 * minutes and the factors live on the player sheet the row opens.
 */
export function ScreenerEdgeRow({ p, provenance, frozen }: { p: ScreenerProp; provenance?: string | null; frozen?: FrozenPrices }) {
  return (
    <EdgeLineRow
      label={`${p.player} ${sideText(p)}`}
      edge={p.priceAmerican !== null ? p.edge : null}
      chance={{ label: "ARCHR", value: p.archr }}
      price={p.priceAmerican}
      book={p.bookName ? { name: p.bookName } : null}
      confidence={p.confidence}
      frozen={frozen}
      whisper={[p.priceAmerican === null ? "line only, no price yet" : null, `${p.game} · ${startLabel(p.startsAt)}`, provenance].filter(Boolean).join(" · ")}
      href={propHref(p)}
    />
  );
}
