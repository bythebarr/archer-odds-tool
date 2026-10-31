import Link from "next/link";
import { SPORT_METAS } from "@/lib/engine/sportsMeta";
import { activeAllSports } from "@/lib/queries/allSports";
import { Glyph, type GlyphKey } from "@/components/brand/Glyph";
import { ScrollRow } from "@/components/ScrollRow";

interface Tile {
  key: string;
  label: string;
  href: string;
  glyph: GlyphKey;
}

/**
 * The sportsbook sport switcher: the deep sports first (NBA, NFL, UFC, MLB,
 * soccer, tennis, F1), then every other sport with a league in season — hockey,
 * cricket, table tennis, darts, esports and the rest — then All Sports.
 */
export async function SportCarousel({ active }: { active?: string }) {
  const deep: Tile[] = SPORT_METAS.map((s) => ({ key: s.sport, label: s.label, href: s.href, glyph: s.sport }));
  const taken = new Set(deep.map((d) => d.key));
  const more: Tile[] = (await activeAllSports().catch(() => []))
    .filter((s) => !taken.has(s.key))
    .map((s) => ({ key: s.key, label: s.label, href: `/sports/${s.key}`, glyph: s.glyph as GlyphKey }));
  const tiles = [...deep, ...more, { key: "all", label: "All", href: "/sports", glyph: "all" as GlyphKey }];
  return (
    <ScrollRow aria-label="Sports" className="-mx-4 px-4">
      <ul className="flex gap-4">
        {tiles.map((s) => {
          const isActive = s.key === active;
          return (
            <li key={s.key} className="shrink-0">
              <Link href={s.href} aria-current={isActive ? "page" : undefined} className="group flex w-14 flex-col items-center gap-1">
                <span
                  className={`flex size-12 items-center justify-center rounded-full ring-1 transition-all ${
                    isActive
                      ? "bg-foreground text-background ring-foreground dark:bg-brand dark:text-brand-foreground dark:ring-brand"
                      : "bg-card text-foreground ring-border group-hover:ring-foreground/40"
                  }`}
                  aria-hidden
                >
                  <Glyph name={s.glyph} className="size-6" />
                </span>
                <span className={`w-16 truncate text-center text-[11px] font-semibold ${isActive ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </ScrollRow>
  );
}
