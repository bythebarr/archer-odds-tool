/**
 * Stat tiles (lib/props/statTiles): every stat category as an on/off tile, all
 * on by default. Two renderings of one look:
 *
 *   StatTileButtons — client state (parlay finder, generator)
 *   StatTileLinks   — every control a link (parlay builder, props screener);
 *                     the URL carries only the stats switched OFF (`xstat`)
 *
 * Plain components (no hooks): the buttons are used from client components,
 * the links render on the server.
 */
import Link from "next/link";
import type { StatTile } from "@/lib/props/statTiles";

const tileClass = (on: boolean) =>
  `inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
    on ? "bg-foreground text-background" : "bg-muted text-muted-foreground line-through decoration-1 hover:text-foreground"
  }`;
const actionClass = "text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline";

function Count({ n, on }: { n: number; on: boolean }) {
  return <span className={`font-mono text-[10px] font-normal ${on ? "opacity-70" : ""}`}>{n}</span>;
}

function Header({ tiles, excluded, allOn, allOff }: { tiles: StatTile[]; excluded: readonly string[]; allOn: React.ReactNode; allOff: React.ReactNode }) {
  const off = tiles.filter((t) => excluded.includes(t.key)).length;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Stats{off > 0 && <span className="ml-1 normal-case tracking-normal">· {tiles.length - off} of {tiles.length} on</span>}
      </span>
      <span className="flex gap-3">
        {allOn}
        {allOff}
      </span>
    </div>
  );
}

export function StatTileButtons({ tiles, excluded, onToggle, onSet }: { tiles: StatTile[]; excluded: readonly string[]; onToggle: (key: string) => void; onSet: (excluded: string[]) => void }) {
  if (!tiles.length) return null;
  return (
    <div>
      <Header
        tiles={tiles}
        excluded={excluded}
        allOn={
          <button type="button" className={actionClass} onClick={() => onSet([])}>
            All on
          </button>
        }
        allOff={
          <button type="button" className={actionClass} onClick={() => onSet(tiles.map((t) => t.key))}>
            All off
          </button>
        }
      />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {tiles.map((t) => {
          const on = !excluded.includes(t.key);
          return (
            <button key={t.key} type="button" aria-pressed={on} title={on ? `Hide ${t.label}` : `Show ${t.label}`} className={tileClass(on)} onClick={() => onToggle(t.key)}>
              {t.label} <Count n={t.count} on={on} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function StatTileLinks({ tiles, excluded, href }: { tiles: StatTile[]; excluded: readonly string[]; href: (excluded: string[]) => string }) {
  if (!tiles.length) return null;
  return (
    <div>
      <Header
        tiles={tiles}
        excluded={excluded}
        allOn={
          <Link scroll={false} href={href([])} className={actionClass}>
            All on
          </Link>
        }
        allOff={
          <Link scroll={false} href={href(tiles.map((t) => t.key))} className={actionClass}>
            All off
          </Link>
        }
      />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {tiles.map((t) => {
          const on = !excluded.includes(t.key);
          const next = on ? [...excluded, t.key] : excluded.filter((k) => k !== t.key);
          return (
            <Link key={t.key} scroll={false} href={href(next)} aria-pressed={on} title={on ? `Hide ${t.label}` : `Show ${t.label}`} className={tileClass(on)}>
              {t.label} <Count n={t.count} on={on} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
