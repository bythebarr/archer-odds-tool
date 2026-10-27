import type { Metadata } from "next";
import Link from "next/link";
import { SPORT_METAS } from "@/lib/engine/sportsMeta";
import { getAllSportsHub } from "@/lib/queries/allSports";
import { SportCarousel } from "@/components/book/SportCarousel";
import { Glyph, type GlyphKey } from "@/components/brand/Glyph";

export const metadata: Metadata = {
  title: "All Sports",
  description: "Every sport and league the books hang lines on — soccer to table tennis — with ARCHR's read on each game.",
};

export const dynamic = "force-dynamic";

function nextLabel(d: Date | null): string | null {
  if (!d) return null;
  const mins = (d.getTime() - Date.now()) / 60_000;
  if (mins <= 0) return "On now";
  if (mins < 60) return `Next in ${Math.round(mins)}m`;
  if (mins < 24 * 60) return `Next in ${Math.round(mins / 60)}h`;
  return `Next ${new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(d)}`;
}

/**
 * The A–Z door: the deep sports up top, then every sport with a league in
 * season, busiest first. Nothing here is ever "offseason" — a sport shows up
 * the moment books hang a line on it.
 */
export default async function SportsHubPage() {
  const hub = await getAllSportsHub();
  const deep = SPORT_METAS.filter((m) => m.sport !== "soccer" && m.sport !== "tennis");
  const tile = "flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-foreground/30";

  return (
    <div className="mx-auto min-h-screen w-full min-w-0 max-w-2xl px-4 pb-10 pt-5 font-sans">
      <SportCarousel active="all" />
      <h1 className="mt-5 font-display text-3xl font-extrabold uppercase italic leading-none tracking-tight text-foreground">All Sports</h1>
      <p className="mt-2 text-sm text-muted-foreground">Every sport the books hang lines on. Each one opens to its leagues, and every game to ARCHR&apos;s full breakdown.</p>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deep models</h2>
        <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {deep.map((m) => (
            <Link key={m.sport} href={m.href} className={tile}>
              <Glyph name={m.sport} className="size-7 shrink-0 text-foreground" />
              <span className="font-display text-lg font-extrabold uppercase italic leading-none text-foreground">{m.label}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-7">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Every sport in season</h2>
        {hub.length === 0 ? (
          <p className="mt-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">The all-sports feed hasn&apos;t run yet — leagues appear here after its first poll.</p>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {hub.map((s) => (
              <Link key={s.key} href={`/sports/${s.key}`} className={`${tile} items-start`}>
                <Glyph name={s.glyph as GlyphKey} className="mt-0.5 size-7 shrink-0 text-foreground" />
                <span className="min-w-0">
                  <span className={`block font-display font-extrabold uppercase italic leading-none text-foreground ${s.label.length > 9 ? "text-[15px]" : "text-lg"}`}>{s.label}</span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {s.leagues} {s.leagues === 1 ? "league" : "leagues"}
                    {s.upcoming > 0 ? ` · ${s.upcoming} games` : ""}
                  </span>
                  {nextLabel(s.nextAt) && <span className="block text-[11px] font-semibold text-primary">{nextLabel(s.nextAt)}</span>}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
