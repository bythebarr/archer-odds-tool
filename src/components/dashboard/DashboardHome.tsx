import Link from "next/link";
import type { Dashboard } from "@/lib/queries/dashboard";
import type { SlateItem, SlateSport, SlateSide } from "@/lib/queries/slate";
import { CompetitorAvatar } from "./CompetitorAvatar";

const SPORT_META: Record<SlateSport, { label: string; icon: string; href: string }> = {
  mlb: { label: "MLB", icon: "⚾", href: "/mlb" },
  ufc: { label: "UFC", icon: "🥊", href: "/ufc" },
  tennis: { label: "Tennis", icon: "🎾", href: "/tennis" },
  soccer: { label: "Soccer", icon: "⚽", href: "/soccer" },
};
const SPORT_ORDER: SlateSport[] = ["mlb", "ufc", "tennis", "soccer"];

const METHOD_META: Record<"ko" | "submission" | "decision", { label: string; color: string }> = {
  ko: { label: "KO/TKO", color: "#ea580c" },
  submission: { label: "Sub", color: "#7c3aed" },
  decision: { label: "Dec", color: "#64748b" },
};

function timeLabel(startUtc: Date): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(
    startUtc
  );
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** The model's favored side + its probability, or null when there's no model. */
function favored(item: SlateItem): { side: SlateSide; opp: SlateSide; prob: number; isHome: boolean } | null {
  const h = item.modelProb?.home;
  const a = item.modelProb?.away;
  if (h === null || h === undefined || a === null || a === undefined) return null;
  const isHome = h >= a;
  return { side: isHome ? item.home : item.away, opp: isHome ? item.away : item.home, prob: isHome ? h : a, isHome };
}

function MethodLeanChip({ item }: { item: SlateItem }) {
  if (!item.methodLean) return null;
  const m = METHOD_META[item.methodLean.method];
  return (
    <span className="font-medium" style={{ color: m.color }}>
      {m.label} {pct(item.methodLean.pct)}
    </span>
  );
}

/* ── Sport tiles ─────────────────────────────────────────────────────────── */

function SportTiles({ counts, date }: { counts: Dashboard["counts"]; date: string }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {SPORT_ORDER.map((sport) => {
        const meta = SPORT_META[sport];
        const count = counts[sport];
        const href = sport === "mlb" ? `${meta.href}?date=${date}` : meta.href;
        return (
          <Link
            key={sport}
            href={href}
            className={`flex flex-col items-center gap-0.5 rounded-xl border border-border bg-card px-2 py-3 ring-1 ring-foreground/5 transition-colors hover:bg-accent/40 ${
              count === 0 ? "opacity-45" : ""
            }`}
          >
            <span aria-hidden className="text-xl leading-none">
              {meta.icon}
            </span>
            <span className="mt-1 font-mono text-lg font-bold leading-none tabular-nums text-foreground">{count}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {meta.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/* ── Play of the day ─────────────────────────────────────────────────────── */

function PlayOfTheDay({ item }: { item: SlateItem }) {
  const fav = favored(item);
  if (!fav) return null;
  const meta = SPORT_META[item.sport];

  return (
    <Link
      href={item.href}
      className="block rounded-2xl border border-border bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:ring-primary/40"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">🔥 Play of the day</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {meta.icon} {timeLabel(item.startUtc)}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <CompetitorAvatar sport={item.sport} side={fav.side} size={46} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold text-foreground">{fav.side.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            vs {fav.opp.name}
            {item.title ? ` · ${item.title}` : ""}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-2xl font-bold leading-none tabular-nums text-foreground">{pct(fav.prob)}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">model</div>
        </div>
      </div>

      {/* Lean bar */}
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: pct(fav.prob) }} />
      </div>

      {item.methodLean ? (
        <div className="mt-2 text-[11px] text-muted-foreground">
          Finish lean: <MethodLeanChip item={item} />
        </div>
      ) : null}
    </Link>
  );
}

/* ── Top leans rail ──────────────────────────────────────────────────────── */

function LeanRow({ item }: { item: SlateItem }) {
  const fav = favored(item);
  if (!fav) return null;
  const meta = SPORT_META[item.sport];

  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/40"
    >
      <span aria-hidden className="w-4 shrink-0 text-center text-sm" title={meta.label}>
        {meta.icon}
      </span>
      <CompetitorAvatar sport={item.sport} side={fav.side} size={26} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-foreground">
          <span className="font-semibold">{fav.side.name}</span>{" "}
          <span className="text-xs text-muted-foreground">vs {fav.opp.name}</span>
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {timeLabel(item.startUtc)}
          {item.methodLean ? (
            <>
              {" · "}
              <MethodLeanChip item={item} />
            </>
          ) : item.title ? (
            ` · ${item.title}`
          ) : null}
        </div>
      </div>
      <div className="shrink-0 font-mono text-sm font-semibold tabular-nums text-foreground">{pct(fav.prob)}</div>
    </Link>
  );
}

/* ── Dashboard ───────────────────────────────────────────────────────────── */

export function DashboardHome({ dashboard, date }: { dashboard: Dashboard; date: string }) {
  const { counts, total, playOfTheDay, topLeans } = dashboard;
  const liveSports = SPORT_ORDER.filter((s) => counts[s] > 0).length;

  return (
    <div className="space-y-6">
      <SportTiles counts={counts} date={date} />

      {total === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing on the board for this date.
        </p>
      ) : (
        <>
          {playOfTheDay ? (
            <PlayOfTheDay item={playOfTheDay} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {total} event{total === 1 ? "" : "s"} on the board across {liveSports} sport
              {liveSports === 1 ? "" : "s"} — model leans light up as matchups are set.
            </p>
          )}

          {topLeans.length > 0 ? (
            <section>
              <div className="mb-1 flex items-center justify-between px-1">
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Today&apos;s top leans
                </h2>
                <Link href={`/slate?date=${date}`} className="text-[11px] font-medium text-primary hover:underline">
                  Full board →
                </Link>
              </div>
              <div className="divide-y divide-border/50 rounded-xl border border-border bg-card px-1 py-0.5">
                {topLeans.map((item) => (
                  <LeanRow key={item.key} item={item} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      {/* Dive deeper */}
      <div className="flex flex-wrap gap-2 pt-1">
        {[
          { href: `/slate?date=${date}`, label: "📊 The Slate" },
          { href: "/props/board", label: "🎯 Props board" },
          { href: "/ufc", label: "🥊 UFC" },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
