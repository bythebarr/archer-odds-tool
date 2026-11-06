"use client";

import { useState } from "react";
import Link from "next/link";
import type { MarketType } from "@/generated/prisma/client";
import { formatAmerican } from "@/lib/odds/americanOdds";
import type { GeneratedLeg, GenerateResult } from "@/lib/builder/generate";
import type { BuilderKind, BuilderWindow } from "@/lib/builder/types";
import { buildSlipPickId, useSlip, type SlipSport } from "@/lib/slip/SlipContext";
import { ScrollRow } from "@/components/ScrollRow";
import { chip } from "@/components/props/kit";

const pct = (p: number) => `${Math.round(p * 100)}%`;
const selectClass = "w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground";

const KINDS: { key: BuilderKind; label: string }[] = [
  { key: "prop", label: "Player props" },
  { key: "ml", label: "Moneylines" },
  { key: "spread", label: "Spreads" },
  { key: "total", label: "Totals" },
];
const WINDOWS: { key: BuilderWindow; label: string }[] = [
  { key: "l5", label: "L5" },
  { key: "l10", label: "L10" },
  { key: "l20", label: "L20" },
  { key: "season", label: "Season" },
];
const RATES = [0.5, 0.6, 0.7, 0.8, 0.9];
const ARCHR = [0, 0.55, 0.6, 0.7];
const SHORTEST: { key: string; label: string; value: number | null }[] = [
  { key: "-200", label: "−200", value: -200 },
  { key: "-300", label: "−300", value: -300 },
  { key: "-500", label: "−500", value: -500 },
  { key: "-1000", label: "−1000", value: -1000 },
  { key: "any", label: "Any", value: null },
];

interface Filters {
  legs: number;
  sports: string[];
  /** One game (a leg's eventId) / one team ("nba:BOS"); "" = any. */
  game: string;
  team: string;
  kinds: BuilderKind[];
  window: BuilderWindow;
  minRate: number;
  minArchr: number;
  shortest: string;
  sameGame: boolean;
  pricedOnly: boolean;
}

const DEFAULTS: Filters = { legs: 4, sports: [], game: "", team: "", kinds: [], window: "l10", minRate: 0.7, minArchr: 0, shortest: "-500", sameGame: false, pricedOnly: false };

const SLIP_SPORTS = new Set<SlipSport>(["mlb", "nfl", "nba", "ufc", "tennis", "soccer"]);
const MARKET: Record<BuilderKind, MarketType | "prop"> = { prop: "prop", ml: "h2h", spread: "spreads", total: "totals" };

/** A fresh seed per draw: every press of Generate gives a new parlay. */
const newSeed = () => Math.floor(Math.random() * 2 ** 31);
const now = () => Date.now();

function startLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
}

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <ScrollRow className="-mx-4 flex gap-2 px-4 pb-1">{children}</ScrollRow>
    </div>
  );
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill={locked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" />
      <path d={locked ? "M5 7V5a3 3 0 0 1 6 0v2" : "M5 7V5a3 3 0 0 1 5.8-1"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
      <path d="M13 5.5A5 5 0 0 0 3.6 4M3 10.5A5 5 0 0 0 12.4 12M3 2v2.5h2.5M13 14v-2.5h-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The Parlay Builder's generator: pick how many legs and your filters, press
 * Generate, lock the legs you like, and regenerate (or swap one leg) for the
 * rest. Each draw is a fresh random pick weighted toward the strongest legs
 * that clear the filters; when too few games are left, it says so rather than
 * padding the parlay with legs that don't.
 */
export function ParlayGenerator({
  sports,
  games,
  teams,
  sportLabels,
}: {
  sports: { key: string; label: string; count: number }[];
  games: { id: string; sport: string; label: string; teams: string[] }[];
  teams: { key: string; sport: string; label: string }[];
  sportLabels: Record<string, string>;
}) {
  const [f, setF] = useState<Filters>(DEFAULTS);
  const [legs, setLegs] = useState<GeneratedLeg[]>([]);
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<Omit<GenerateResult, "parlay"> | null>(null);
  const [parlay, setParlay] = useState<GenerateResult["parlay"] | null>(null);
  const [pending, setPending] = useState<"all" | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const slip = useSlip();

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));
  // The Game and Team menus follow the sports picked, and the team menu the game.
  const gameOptions = games.filter((g) => !f.sports.length || f.sports.includes(g.sport));
  const inGame = f.game ? new Set(games.find((g) => g.id === f.game)?.teams ?? []) : null;
  const teamOptions = teams.filter((t) => (!f.sports.length || f.sports.includes(t.sport)) && (!inGame || inGame.has(t.key)));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function call(lockedIds: string[], exclude: string[], legCount = f.legs): Promise<GenerateResult | null> {
    setError(null);
    try {
      const res = await fetch("/api/parlay-builder/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...f,
          legs: legCount,
          shortest: SHORTEST.find((s) => s.key === f.shortest)?.value ?? null,
          locked: lockedIds,
          exclude,
          seed: newSeed(),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as GenerateResult;
    } catch {
      setError("Couldn't reach the generator. Try again in a moment.");
      return null;
    }
  }

  async function generate() {
    setPending("all");
    setAdded(false);
    const keep = legs.filter((l) => locked.has(l.id)).map((l) => l.id);
    const out = await call(keep, legs.filter((l) => !locked.has(l.id)).map((l) => l.id));
    if (out) {
      setLegs(out.parlay.legs);
      setParlay(out.parlay);
      setMeta({ qualifying: out.qualifying, short: out.short });
      setLocked(new Set(keep.filter((id) => out.parlay.legs.some((l) => l.id === id))));
    }
    setPending(null);
  }

  /** Replace one leg in place: every other leg held, this one left out of the draw. */
  async function swap(id: string) {
    setPending(id);
    setAdded(false);
    const others = legs.filter((l) => l.id !== id).map((l) => l.id);
    const out = await call(others, [id], legs.length);
    if (out) {
      const fresh = out.parlay.legs.find((l) => !others.includes(l.id));
      if (fresh) {
        const next = legs.map((l) => (l.id === id ? { ...fresh, locked: false } : l));
        setLegs(next);
        // Re-price from the server's figures: the parlay holds the same legs in another order.
        setParlay({ ...out.parlay, legs: next });
      } else {
        setError("No other leg fits that spot with these filters.");
      }
    }
    setPending(null);
  }

  function addToSlip() {
    for (const l of legs) {
      if (l.priceAmerican === null) continue;
      const sport: SlipSport = SLIP_SPORTS.has(l.sport as SlipSport) ? (l.sport as SlipSport) : "all";
      const bookKey = (l.bookName ?? "best").toLowerCase().replace(/\s+/g, "");
      slip.addPick({
        id: buildSlipPickId({ sport, matchId: l.eventId, marketType: MARKET[l.kind], side: l.label, point: null, bookKey }),
        sport,
        matchId: l.eventId,
        matchLabel: l.eventLabel,
        selectionLabel: l.label,
        marketType: MARKET[l.kind],
        point: null,
        bookKey,
        bookName: l.bookName ?? "Best price",
        priceAmerican: l.priceAmerican,
        addedAt: now(),
      });
    }
    setAdded(true);
  }

  const lockedCount = legs.filter((l) => locked.has(l.id)).length;
  const priced = legs.filter((l) => l.priceAmerican !== null).length;

  return (
    <section className="mt-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-foreground">Legs</p>
          <div className="flex items-center gap-1 rounded-full bg-muted p-1">
            <button type="button" aria-label="Fewer legs" onClick={() => set("legs", Math.max(1, f.legs - 1))} className="size-8 rounded-full text-lg font-bold text-foreground hover:bg-background">
              −
            </button>
            <span className="w-8 text-center font-mono text-base font-bold text-foreground" aria-live="polite">
              {f.legs}
            </span>
            <button type="button" aria-label="More legs" onClick={() => set("legs", Math.min(15, f.legs + 1))} className="size-8 rounded-full text-lg font-bold text-foreground hover:bg-background">
              +
            </button>
          </div>
        </div>

        <Row title="Sports">
          <button type="button" onClick={() => setF((x) => ({ ...x, sports: [], game: "", team: "" }))} className={chip(f.sports.length === 0)}>
            All sports
          </button>
          {sports.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setF((x) => ({ ...x, sports: toggle(x.sports, s.key), game: "", team: "" }))}
              className={chip(f.sports.includes(s.key))}
            >
              {s.label} <span className="opacity-60">{s.count}</span>
            </button>
          ))}
        </Row>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Game</span>
            <select value={f.game} onChange={(e) => setF((x) => ({ ...x, game: e.target.value, team: "" }))} className={selectClass}>
              <option value="">All games</option>
              {gameOptions.map((g) => (
                <option key={g.id} value={g.id}>
                  {f.sports.length === 1 ? "" : `${sportLabels[g.sport] ?? g.sport} · `}
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Team</span>
            <select value={f.team} onChange={(e) => set("team", e.target.value)} className={selectClass}>
              <option value="">All teams</option>
              {teamOptions.map((t) => (
                <option key={t.key} value={t.key}>
                  {f.sports.length === 1 ? "" : `${sportLabels[t.sport] ?? t.sport} · `}
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Row title="Bet types">
          <button type="button" onClick={() => set("kinds", [])} className={chip(f.kinds.length === 0)}>
            Everything
          </button>
          {KINDS.map((k) => (
            <button key={k.key} type="button" onClick={() => set("kinds", toggle(f.kinds, k.key))} className={chip(f.kinds.includes(k.key))}>
              {k.label}
            </button>
          ))}
        </Row>
        <Row title="Each leg has hit at least">
          {RATES.map((r) => (
            <button key={r} type="button" onClick={() => set("minRate", r)} className={chip(f.minRate === r)}>
              {pct(r)}
            </button>
          ))}
          <span className="self-center px-1 text-xs text-muted-foreground">over</span>
          {WINDOWS.map((w) => (
            <button key={w.key} type="button" onClick={() => set("window", w.key)} className={chip(f.window === w.key)}>
              {w.label}
            </button>
          ))}
        </Row>
        <Row title="ARCHR chance per leg">
          {ARCHR.map((a) => (
            <button key={a} type="button" onClick={() => set("minArchr", a)} className={chip(f.minArchr === a)}>
              {a === 0 ? "Any" : `${pct(a)}+`}
            </button>
          ))}
        </Row>
        <Row title="Shortest leg">
          {SHORTEST.map((s) => (
            <button key={s.key} type="button" onClick={() => set("shortest", s.key)} className={chip(f.shortest === s.key)}>
              {s.label}
            </button>
          ))}
        </Row>
        <Row title="Options">
          {f.game || f.team ? (
            <span className={chip(true)} title="One game or team picked: its legs share a game">
              Same-game legs (on)
            </span>
          ) : (
            <button type="button" onClick={() => set("sameGame", !f.sameGame)} className={chip(f.sameGame)} aria-pressed={f.sameGame}>
              Same-game legs
            </button>
          )}
          <button type="button" onClick={() => set("pricedOnly", !f.pricedOnly)} className={chip(f.pricedOnly)} aria-pressed={f.pricedOnly}>
            Book-priced legs only
          </button>
        </Row>

        <button
          type="button"
          onClick={generate}
          disabled={pending !== null}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-black transition hover:brightness-95 active:scale-[0.99] disabled:opacity-60"
        >
          {pending === "all" && <span className="size-4 animate-spin rounded-full border-2 border-black/30 border-t-black" aria-hidden />}
          {legs.length === 0 ? "Generate parlay" : lockedCount ? `Regenerate the other ${Math.max(0, f.legs - lockedCount)}` : "Generate another"}
        </button>
        {lockedCount > 0 && (
          <button type="button" onClick={() => setLocked(new Set())} className="mt-2 w-full text-center text-xs font-semibold text-muted-foreground hover:text-foreground">
            Unlock all ({lockedCount} locked)
          </button>
        )}
      </div>

      {error && <p className="mt-3 rounded-xl border border-border bg-muted/40 p-3 text-xs text-foreground">{error}</p>}

      {meta && meta.short > 0 && (
        <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-foreground">
          <p className="font-semibold">Not enough plays for {f.legs} legs with these filters</p>
          <p className="mt-0.5 text-muted-foreground">
            {legs.length === 0
              ? "Nothing on the board clears them right now."
              : `Found ${legs.length - lockedCount} that ${legs.length - lockedCount === 1 ? "fits" : "fit"} around your locked legs, ${meta.short} short.`}{" "}
            Lower the hit-rate bar, allow shorter legs, add sports or bet types, or allow same-game legs.
          </p>
        </div>
      )}

      {parlay && legs.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-3">
            <p className="text-sm font-semibold text-foreground">
              {legs.length}-leg parlay
              {parlay.priceAmerican !== null && (
                <span className="ml-2 font-mono text-lg font-bold">
                  {formatAmerican(parlay.priceAmerican)}
                  {parlay.estimated && <span className="ml-1 align-middle text-[10px] font-semibold uppercase text-muted-foreground">est.</span>}
                </span>
              )}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {parlay.archr !== null && (
                <>
                  ARCHR <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{(parlay.archr * 100).toFixed(1)}%</span> ·{" "}
                </>
              )}
              records <span className="font-mono text-foreground">{(parlay.record * 100).toFixed(1)}%</span>
              {meta && <> · {meta.qualifying.toLocaleString()} legs qualify</>}
            </p>
          </div>
          <ul className="mt-2 divide-y divide-border border-t border-border">
            {legs.map((l) => {
              const isLocked = locked.has(l.id);
              const [h, n] = l.rates[f.window];
              return (
                <li key={l.id} className={`flex items-center gap-2 px-3 py-2.5 text-xs transition-colors ${isLocked ? "bg-brand/10" : ""} ${pending === l.id ? "opacity-50" : ""}`}>
                  <button
                    type="button"
                    onClick={() => setLocked((s) => (s.has(l.id) ? new Set([...s].filter((x) => x !== l.id)) : new Set([...s, l.id])))}
                    aria-pressed={isLocked}
                    aria-label={isLocked ? `Unlock ${l.label}` : `Lock ${l.label}`}
                    className={`grid size-8 shrink-0 place-items-center rounded-lg transition-colors ${isLocked ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                  >
                    <LockIcon locked={isLocked} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">{l.league}</span>
                      <Link href={l.href} className="font-semibold text-foreground hover:underline">
                        {l.label}
                      </Link>
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {l.eventLabel} · {startLabel(l.startsAt)} · {h}/{n}
                      {l.archr !== null && <> · ARCHR {pct(l.archr)}</>}
                    </p>
                  </div>
                  <div className="shrink-0 text-right font-mono">
                    <p className="text-foreground">{l.displayPrice !== null ? formatAmerican(l.displayPrice) : "—"}</p>
                    <p className="font-sans text-[10px] text-muted-foreground">{l.fair ? "ARCHR fair" : (l.bookName ?? "")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => swap(l.id)}
                    disabled={pending !== null || isLocked}
                    aria-label={`Swap ${l.label} for another leg`}
                    title={isLocked ? "Unlock to swap" : "Swap this leg"}
                    className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    {pending === l.id ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : <SwapIcon />}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
            <p className="text-[11px] text-muted-foreground">Lock the legs you like, then regenerate the rest, or swap one at a time.</p>
            {priced > 0 && (
              <button type="button" onClick={addToSlip} className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background">
                {added ? "Added to slip ✓" : `Add ${priced === legs.length ? "all" : `${priced} priced`} to slip`}
              </button>
            )}
          </div>
        </div>
      )}

      {!parlay && !error && (
        <p className="mt-4 text-center text-xs text-muted-foreground">Set your filters and press Generate. Every press draws a new parlay from the legs that clear them.</p>
      )}

      <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">
        Each draw picks at random from the legs that clear your filters, favoring the strongest (ARCHR&apos;s chance and the record over the window), one
        leg per game unless same-game legs are on. Many props are posted before a book prices them: those carry ARCHR&apos;s fair price (its chance as
        odds, no vig), marked &quot;ARCHR fair&quot;, and the parlay&apos;s price is then an estimate. Turn on &quot;Book-priced legs only&quot; for a
        parlay you can price at a book today. Legs from different games are treated as independent. Research only.
      </p>
    </section>
  );
}
