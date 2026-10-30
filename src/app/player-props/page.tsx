import type { Metadata } from "next";
import Link from "next/link";
import { SportCarousel } from "@/components/book/SportCarousel";
import { Glyph, type GlyphKey } from "@/components/brand/Glyph";

export const metadata: Metadata = {
  title: "Player Props — every sport",
  description: "Player props for every sport ARCHR models: ARCHR's own line and chance for every player, and every book's price once they post.",
};

/** Every sport with a props product, in lineup order. */
const PROPS: { sport: GlyphKey; label: string; href: string; covers: string }[] = [
  { sport: "nba", label: "NBA", href: "/nba/props", covers: "Points, rebounds, assists, threes, combos, stocks" },
  { sport: "nfl", label: "NFL", href: "/nfl/props", covers: "Passing, rushing and receiving yards, receptions, TDs" },
  { sport: "ufc", label: "UFC", href: "/ufc/props", covers: "Significant strikes, takedowns, knockdowns" },
  { sport: "soccer", label: "Soccer", href: "/sports/soccer/props", covers: "Anytime scorer, shots, shots on target, assists, cards" },
  { sport: "tennis", label: "Tennis", href: "/sports/tennis/props", covers: "Games won, total games, aces, double faults" },
  { sport: "mlb", label: "MLB", href: "/mlb/props", covers: "Hits, total bases, strikeouts, home runs" },
  { sport: "hockey", label: "NHL", href: "/player-props/lines?league=hockey%2Fnhl", covers: "Book lines: points, shots on goal, goals, assists, saves" },
];

/**
 * The Props tab: one door per sport. Each sport's board lists every player with
 * a role in its upcoming games, priced by ARCHR before the books post a line.
 */
export default function PlayerPropsHubPage() {
  return (
    <div className="mx-auto min-h-screen w-full min-w-0 max-w-2xl px-4 pb-10 pt-5 font-sans">
      <SportCarousel active="all" />
      <h1 className="mt-5 font-display text-3xl font-extrabold uppercase italic leading-none tracking-tight text-foreground">Player Props</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        ARCHR&apos;s own line and chance for every player with a role, before the books post. Their prices slot in when they do.
      </p>
      <p className="mt-4 text-xs text-muted-foreground">
        <Link href="/nba/parlays" className="font-semibold text-foreground underline-offset-2 hover:underline">NBA Parlay Finder</Link>: same-game legs that have hit together ·{" "}
        <Link href="/player-props/lines" className="font-semibold text-foreground underline-offset-2 hover:underline">Book prop lines</Link> for every league
      </p>
      <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {PROPS.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-foreground/30"
          >
            <Glyph name={p.sport} className="mt-0.5 size-7 shrink-0 text-foreground" />
            <span className="min-w-0">
              <span className="block font-display text-lg font-extrabold uppercase italic leading-none text-foreground">{p.label}</span>
              <span className="mt-1 block text-[11px] text-muted-foreground">{p.covers}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
