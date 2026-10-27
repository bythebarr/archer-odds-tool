import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getFuturesBoard, getSportBoard } from "@/lib/queries/allSports";
import { allSport } from "@/lib/allSports/sports";
import { SportCarousel } from "@/components/book/SportCarousel";
import { LeagueLogo } from "@/components/allSports/LeagueLogo";
import { AllSportEventRow, AllSportListHeader } from "@/components/allSports/AllSportEventRow";
import { FuturesBoard } from "@/components/allSports/FuturesBoard";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

type Params = Promise<{ sport: string; league: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { sport, league } = await params;
  const row = await prisma.league.findUnique({ where: { id: `${sport}/${league}` }, select: { name: true, region: true } });
  if (!row) return {};
  const title = `${row.name}${row.region ? ` (${row.region})` : ""} odds`;
  return { title, description: `${row.name}: best price at every book and ARCHR's read on every game.` };
}

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const dayLabel = (d: Date) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York" }).format(d);

/** One league: its games by day, or its futures board. */
export default async function LeaguePageAll({ params }: { params: Params }) {
  const { sport, league } = await params;
  if (!allSport(sport)) notFound();
  const board = await getSportBoard(sport, league);
  const selected = board.selected ?? board.futures.find((f) => f.slug === league) ?? null;
  if (!selected) notFound();

  const header = (
    <>
      <SportCarousel active={sport} />
      <Link href={`/sports/${sport}`} className="mt-5 inline-block text-sm text-muted-foreground hover:text-foreground">
        ← {board.sport.label}
      </Link>
      <div className="mt-2 flex items-center gap-3">
        <LeagueLogo name={selected.name} region={selected.region} logoUrl={selected.logoUrl} size={40} />
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-extrabold uppercase italic leading-tight tracking-tight text-foreground">{selected.name}</h1>
          {selected.region && <p className="text-xs text-muted-foreground">{selected.region}</p>}
        </div>
      </div>
    </>
  );

  if (selected.outright) {
    const futures = await getFuturesBoard(selected.id);
    return (
      <div className="mx-auto min-h-screen w-full min-w-0 max-w-2xl px-4 pb-10 pt-5 font-sans">
        {header}
        <div className="mt-5">{futures && futures.rows.length > 0 ? <FuturesBoard rows={futures.rows} /> : <EmptyState title="No prices posted yet" />}</div>
      </div>
    );
  }

  const events = board.boards[0]?.events ?? [];
  const threeWay = board.sport.family === "goals" && sport !== "hockey";
  const days = [...new Set(events.map((e) => dayKey(e.startsAt)))];
  const noSpread = !threeWay && events.every((e) => !e.spread.home && !e.spread.away && e.archr?.spread == null);
  return (
    <div className="mx-auto min-h-screen w-full min-w-0 max-w-2xl px-4 pb-10 pt-5 font-sans">
      {header}
      {events.length === 0 ? (
        <EmptyState title="No lines posted for the next week">Books hang lines a few days out; this fills the moment they do.</EmptyState>
      ) : (
        days.map((day) => {
          const list = events.filter((e) => dayKey(e.startsAt) === day);
          return (
            <section key={day} className="mt-6">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{dayLabel(list[0]!.startsAt)}</h2>
              <AllSportListHeader threeWay={threeWay} noSpread={noSpread} />
              <div className="space-y-2">
                {list.map((e) => (
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
