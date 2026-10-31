import type { Metadata } from "next";
import Link from "next/link";
import { SportCarousel } from "@/components/book/SportCarousel";
import { Glyph, type GlyphKey } from "@/components/brand/Glyph";
import { PropsScreener, type ScreenerParams } from "@/components/screener/PropsScreener";
import { refreshOnView } from "@/lib/ops/refreshOnView";
import { ScrollRow } from "@/components/ScrollRow";

export const metadata: Metadata = {
  title: "Player Props — every sport, screened by hit rate",
  description:
    "Player props for every sport ARCHR models, with a screener: hit rate over the last 3, 5, 10, 15 games, this season and last, by sport, game, team and stat, with ARCHR's chance and every book's price.",
};

export const dynamic = "force-dynamic";

/** Every sport with a props product, in lineup order. */
const PROPS: { sport: GlyphKey; label: string; href: string }[] = [
  { sport: "nba", label: "NBA", href: "/nba/props" },
  { sport: "nfl", label: "NFL", href: "/nfl/props" },
  { sport: "ufc", label: "UFC", href: "/ufc/props" },
  { sport: "soccer", label: "Soccer", href: "/sports/soccer/props" },
  { sport: "tennis", label: "Tennis", href: "/sports/tennis/props" },
  { sport: "mlb", label: "MLB", href: "/mlb/props" },
  { sport: "hockey", label: "NHL", href: "/player-props/lines?league=hockey%2Fnhl" },
];

/**
 * The Props tab: a door to each sport's board, and the screener — every prop
 * on the board (NBA, NFL, MLB, soccer, UFC, tennis), filtered by a hit-rate bar on any window
 * (L3, L5, L10, L15, this season, last season, or all of them at once), sport,
 * game, team, stat and side, main line or alt rungs, ARCHR's chance and edge,
 * and price. The filters live in the URL, so the server does the screening and
 * a screen is shareable.
 */
export default async function PlayerPropsHubPage({ searchParams }: { searchParams: Promise<ScreenerParams> }) {
  const params = await searchParams;
  await refreshOnView([["espn-props", 30]]);
  return (
    <div className="mx-auto min-h-screen w-full min-w-0 max-w-6xl px-4 pb-24 pt-5 font-sans">
      <SportCarousel active="all" />
      <h1 className="mt-5 font-display text-3xl font-extrabold uppercase italic leading-none tracking-tight text-foreground">Player Props</h1>
      <ScrollRow className="-mx-4 mt-3 flex gap-2 px-4 pb-1">
        {PROPS.map((p) => (
          <Link key={p.href} href={p.href} className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/70">
            <Glyph name={p.sport} className="size-4" />
            {p.label}
          </Link>
        ))}
      </ScrollRow>
      <p className="mt-3 text-xs text-muted-foreground">
        <Link href="/parlay-builder" className="font-semibold text-foreground underline-offset-2 hover:underline">Parlay Builder</Link> ·{" "}
        <Link href="/nba/parlays" className="font-semibold text-foreground underline-offset-2 hover:underline">NBA</Link> and{" "}
        <Link href="/nfl/parlays" className="font-semibold text-foreground underline-offset-2 hover:underline">NFL</Link> Parlay Finders ·{" "}
        <Link href="/player-props/lines" className="font-semibold text-foreground underline-offset-2 hover:underline">Book prop lines</Link>
      </p>

      <div className="mt-5">
        <PropsScreener params={params} basePath="/player-props" />
      </div>
    </div>
  );
}
