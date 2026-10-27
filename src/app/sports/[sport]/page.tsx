import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSportBoard } from "@/lib/queries/allSports";
import { allSport } from "@/lib/allSports/sports";
import { SportCarousel } from "@/components/book/SportCarousel";
import { Glyph, type GlyphKey } from "@/components/brand/Glyph";
import { LeagueLogo } from "@/components/allSports/LeagueLogo";
import { AllSportEventRow, AllSportListHeader } from "@/components/allSports/AllSportEventRow";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ sport: string }> }): Promise<Metadata> {
  const { sport } = await params;
  const s = allSport(sport);
  if (!s) return {};
  return { title: `${s.label} odds`, description: `${s.label}: every league in season, the best price at every book, and ARCHR's read on each game.` };
}

/**
 * A sport's board: its leagues as chips (the big ones first), futures, then the
 * next week of games league by league — best price per side with ARCHR's edge.
 */
export default async function SportBoardPage({ params }: { params: Promise<{ sport: string }> }) {
  const { sport } = await params;
  if (!allSport(sport)) notFound();
  const board = await getSportBoard(sport, null);
  const threeWay = board.sport.family === "goals" && sport !== "hockey";

  return (
    <div className="mx-auto min-h-screen w-full min-w-0 max-w-2xl px-4 pb-10 pt-5 font-sans">
      <SportCarousel active={sport} />
      <div className="mt-5 flex items-center gap-2.5 text-foreground">
        <Glyph name={board.sport.glyph as GlyphKey} className="size-8" />
        <h1 className="font-display text-3xl font-extrabold uppercase italic leading-none tracking-tight">{board.sport.label}</h1>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {board.chips.length} {board.chips.length === 1 ? "league" : "leagues"}{" "}in season · every book&apos;s best price · ARCHR&apos;s edge on each game
      </p>

      {board.chips.length > 0 && (
        <nav aria-label="Leagues" className="-mx-4 mt-4 overflow-x-auto px-4 [scrollbar-width:none]">
          <ul className="flex gap-2">
            {board.chips.map((c) => (
              <li key={c.id} className="shrink-0">
                <Link href={`/sports/${sport}/${c.slug}`} className="flex items-center gap-2 rounded-full border border-border bg-card py-1.5 pl-1.5 pr-3 text-xs font-semibold text-foreground hover:border-foreground/40">
                  <LeagueLogo name={c.name} region={c.region} logoUrl={c.logoUrl} size={22} />
                  <span className="max-w-[10rem] truncate">{c.name}</span>
                  {c.upcoming > 0 && <span className="font-mono text-[10px] text-muted-foreground">{c.upcoming}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {board.futures.length > 0 && (
        <section className="mt-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Futures</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {board.futures.map((f) => (
              <Link key={f.id} href={`/sports/${sport}/${f.slug}`} className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted-foreground/15">
                <span aria-hidden>🏆</span>
                {f.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {board.boards.length === 0 ? (
        <EmptyState title={`No ${board.sport.label.toLowerCase()} lines posted right now`}>
          Books hang lines a few days out; this board fills the moment they do{board.futures.length ? ", and the futures above are live now" : ""}.
        </EmptyState>
      ) : (
        board.boards.map((b) => {
          const noSpread = !threeWay && b.events.every((e) => !e.spread.home && !e.spread.away);
          return (
          <section key={b.league.id} className="mt-7">
            <div className="mb-2 flex items-center justify-between gap-2">
              <Link href={`/sports/${sport}/${b.league.slug}`} className="flex min-w-0 items-center gap-2">
                <LeagueLogo name={b.league.name} region={b.league.region} logoUrl={b.league.logoUrl} size={28} />
                <span className="min-w-0">
                  <span className="block truncate font-display text-lg font-extrabold uppercase italic leading-tight text-foreground">{b.league.name}</span>
                  {b.league.region && <span className="block text-[11px] leading-tight text-muted-foreground">{b.league.region}</span>}
                </span>
              </Link>
              <Link href={`/sports/${sport}/${b.league.slug}`} className="shrink-0 text-sm font-semibold text-primary hover:underline">
                All {b.league.upcoming} ›
              </Link>
            </div>
            <AllSportListHeader threeWay={threeWay} noSpread={noSpread} />
            <div className="space-y-2">
              {b.events.slice(0, 6).map((e) => (
                <AllSportEventRow key={e.id} event={e} sport={sport} threeWay={threeWay} noSpread={noSpread} />
              ))}
            </div>
          </section>
          );
        })
      )}
    </div>
  );
}
