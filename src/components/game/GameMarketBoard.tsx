"use client";

import { useCallback, useMemo, useState } from "react";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { mainOffer, type Offer, type OfferSide } from "@/lib/gameModel/offers";
import type { SlipSport } from "@/lib/slip/SlipContext";
import { Logo } from "@/components/Logo";
import { BetSheet } from "./BetSheet";
import { PERIOD_LABEL, signedLine, type TeamNames } from "./labels";
import { ScrollRow } from "@/components/ScrollRow";

type Section = "popular" | "game" | "alt" | "teamTotals" | "h1" | "h2" | "quarters";

const SECTION_LABEL: Record<Section, string> = {
  popular: "Popular",
  game: "Game Lines",
  alt: "Alternates",
  teamTotals: "Team Totals",
  h1: "1st Half",
  h2: "2nd Half",
  quarters: "Quarters",
};

/** A model edge worth lighting up — clear of line-timing noise after the market blend. */
const EDGE = 0.02;

export interface BoardTeams extends TeamNames {
  home: { name: string; abbreviation: string; logoUrl: string };
  away: { name: string; abbreviation: string; logoUrl: string };
}

/** One price button: the number, the best price, and a volt edge tag when the model likes it. */
function Cell({ offer, side, top, onPick }: { offer: Offer | null; side: string; top?: string; onPick: (o: Offer, side: string) => void }) {
  const s: OfferSide | undefined = offer?.sides.find((x) => x.side === side);
  if (!offer || !s?.best) {
    return <div className="flex h-12 items-center justify-center rounded-lg bg-muted/50 text-xs text-muted-foreground/60">—</div>;
  }
  const edge = s.ev !== null && s.ev >= EDGE ? s.ev : null;
  return (
    <button
      type="button"
      onClick={() => onPick(offer, side)}
      className={`relative flex h-12 flex-col items-center justify-center rounded-lg bg-muted px-1 text-center transition-colors hover:bg-muted-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${edge !== null ? "ring-1 ring-inset ring-brand" : ""}`}
      aria-label={`${top ?? ""} ${formatAmerican(s.best.priceAmerican)}${edge !== null ? `, model edge ${(edge * 100).toFixed(1)} percent` : ""}`}
    >
      {top && <span className="text-[11px] font-medium leading-tight text-muted-foreground">{top}</span>}
      <span className="font-mono text-sm font-semibold leading-tight text-foreground">{formatAmerican(s.best.priceAmerican)}</span>
      {edge !== null && (
        <span className="absolute -right-1 -top-1.5 rounded bg-brand px-1 font-mono text-[9px] font-bold leading-[14px] text-brand-foreground">+{(edge * 100).toFixed(1)}</span>
      )}
    </button>
  );
}

function TeamCell({ team }: { team: BoardTeams["home"] }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Logo sources={[team.logoUrl]} alt={team.name} fallbackText={team.abbreviation} size={22} />
      <span className="truncate text-sm font-semibold text-foreground">{team.name.split(" ").at(-1)}</span>
    </div>
  );
}

/** Spread / Total / Moneyline for one period, two team rows — the sportsbook grid. */
function LinesGrid({ offers, period, teams, onPick }: { offers: Offer[]; period: string; teams: BoardTeams; onPick: (o: Offer, s: string) => void }) {
  const pick = (kind: string) => mainOffer(offers.filter((o) => o.period === period && o.kind === kind && o.team === ""));
  const spread = pick("spread");
  const total = pick("total");
  const ml = pick("ml");
  if (!spread && !total && !ml) return null;
  const draw = ml?.sides.find((s) => s.side === "draw");
  const sideOf = (o: Offer | null, side: string) => o?.sides.find((s) => s.side === side);
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem] items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{PERIOD_LABEL[period]}</span>
        {["Spread", "Total", "Money"].map((h) => (
          <span key={h} className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</span>
        ))}
        {(["away", "home"] as const).map((t) => (
          <div key={t} className="contents">
            <TeamCell team={teams[t]} />
            <Cell offer={spread} side={t} top={sideOf(spread, t) ? signedLine(sideOf(spread, t)!.point) : undefined} onPick={onPick} />
            <Cell offer={total} side={t === "away" ? "over" : "under"} top={total ? `${t === "away" ? "O" : "U"} ${total.line}` : undefined} onPick={onPick} />
            <Cell offer={ml} side={t} onPick={onPick} />
          </div>
        ))}
        {draw && (
          <div className="contents">
            <span className="text-sm font-semibold text-muted-foreground">Draw</span>
            <span />
            <span />
            <Cell offer={ml} side="draw" onPick={onPick} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Both teams to score and draw no bet — the soccer staples, as one two-button row each. */
function Specials({ offers, teams, onPick }: { offers: Offer[]; teams: BoardTeams; onPick: (o: Offer, s: string) => void }) {
  const btts = offers.find((o) => o.period === "game" && o.kind === "btts") ?? null;
  const dnb = offers.find((o) => o.period === "game" && o.kind === "dnb") ?? null;
  if (!btts && !dnb) return null;
  const rows = [
    btts && { title: "Both teams to score", offer: btts, sides: [["yes", "Yes"], ["no", "No"]] as const },
    dnb && { title: "Draw no bet", offer: dnb, sides: [["home", teams.home.abbreviation], ["away", teams.away.abbreviation]] as const },
  ].filter((r): r is NonNullable<typeof r> => Boolean(r));
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3">
      {rows.map((r) => (
        <div key={r.title} className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground">{r.title}</span>
          {r.sides.map(([side, label]) => (
            <Cell key={side} offer={r.offer} side={side} top={label} onPick={onPick} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Every number books hang on one market, as a ladder of two-sided rows. */
function Ladder({ title, offers, kind, teams, onPick }: { title: string; offers: Offer[]; kind: "spread" | "total" | "teamTotal"; teams: BoardTeams; onPick: (o: Offer, s: string) => void }) {
  const [open, setOpen] = useState(false);
  if (offers.length === 0) return null;
  const sorted = [...offers].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  const main = mainOffer(offers);
  const mainIdx = Math.max(0, sorted.findIndex((o) => o.id === main?.id));
  const shown = open ? sorted : sorted.slice(Math.max(0, mainIdx - 2), mainIdx + 3);
  const [a, b] = kind === "spread" ? (["away", "home"] as const) : (["over", "under"] as const);
  const head = kind === "spread" ? [teams.away.abbreviation, teams.home.abbreviation] : ["Over", "Under"];
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground">{title}</span>
        {sorted.length > shown.length || open ? (
          <button type="button" onClick={() => setOpen((x) => !x)} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground">
            {open ? "Fewer" : `All ${sorted.length} lines`}
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {head.map((h) => (
          <span key={h} className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</span>
        ))}
        {shown.map((o) => {
          const sa = o.sides.find((s) => s.side === a);
          const sb = o.sides.find((s) => s.side === b);
          const top = (s: OfferSide | undefined, ou: string) => (s ? (kind === "spread" ? signedLine(s.point) : `${ou} ${s.point}`) : undefined);
          return (
            <div key={o.id} className={`contents ${o.id === main?.id ? "[&>*]:ring-1 [&>*]:ring-foreground/20" : ""}`}>
              <Cell offer={o} side={a} top={top(sa, "O")} onPick={onPick} />
              <Cell offer={o} side={b} top={top(sb, "U")} onPick={onPick} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TeamTotals({ offers, period, teams, onPick }: { offers: Offer[]; period: string; teams: BoardTeams; onPick: (o: Offer, s: string) => void }) {
  const blocks = (["away", "home"] as const).map((t) => ({ t, list: offers.filter((o) => o.period === period && o.kind === "teamTotal" && o.team === t) }));
  if (blocks.every((b) => b.list.length === 0)) return null;
  return (
    <>
      {blocks.map(({ t, list }) => (
        <Ladder key={t} title={`${teams[t].name} total${period === "game" ? "" : ` · ${PERIOD_LABEL[period]}`}`} offers={list} kind="teamTotal" teams={teams} onPick={onPick} />
      ))}
    </>
  );
}

/**
 * Every line on a game, sportsbook-style: section pills (Popular, Game Lines,
 * Alternates, Team Totals, halves, quarters), price buttons with the best book's
 * price and a volt tag where the model sees an edge. Tapping any price opens the
 * bet sheet: every book's price on it and the model's read.
 */
export function GameMarketBoard({ offers, teams, sport, matchId }: { offers: Offer[]; teams: BoardTeams; sport: SlipSport; matchId: string }) {
  const [picked, setPicked] = useState<{ id: string; side: string } | null>(null);
  const onPick = useCallback((o: Offer, side: string) => setPicked({ id: o.id, side }), []);
  const close = useCallback(() => setPicked(null), []);
  const has = useCallback((f: (o: Offer) => boolean) => offers.some(f), [offers]);

  const sections = useMemo(() => {
    const list: Section[] = ["popular", "game"];
    const count = (kind: string) => offers.filter((o) => o.period === "game" && o.kind === kind && o.team === "").length;
    if (count("spread") > 1 || count("total") > 1) list.push("alt");
    if (has((o) => o.kind === "teamTotal")) list.push("teamTotals");
    if (has((o) => o.period === "h1")) list.push("h1");
    if (has((o) => o.period === "h2")) list.push("h2");
    if (has((o) => o.period.startsWith("q"))) list.push("quarters");
    return list;
  }, [offers, has]);
  const [section, setSection] = useState<Section>("popular");

  const of = (period: string, kind: string, team = "") => offers.filter((o) => o.period === period && o.kind === kind && o.team === team);
  const pickedOffer = picked ? offers.find((o) => o.id === picked.id) ?? null : null;
  const matchLabel = `${teams.away.abbreviation} @ ${teams.home.abbreviation}`;
  const edges = offers.flatMap((o) => o.sides.filter((s) => s.ev !== null && s.ev >= EDGE)).length;

  return (
    <div className="mt-4">
      <ScrollRow className="-mx-4 flex gap-1.5 px-4 pb-1">
        {sections.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSection(s)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${section === s ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          >
            {SECTION_LABEL[s]}
          </button>
        ))}
      </ScrollRow>
      {edges > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          <span className="rounded bg-brand px-1 font-mono text-[10px] font-bold text-brand-foreground">+x.x</span> {`${edges} price${edges === 1 ? "" : "s"} `}where ARCHR&apos;s
          blended chance beats the price. Tap any price to see it run against the model.
        </p>
      )}

      <div className="mt-3 space-y-3">
        {(section === "popular" || section === "game") && <LinesGrid offers={offers} period="game" teams={teams} onPick={onPick} />}
        {(section === "popular" || section === "game") && <Specials offers={offers} teams={teams} onPick={onPick} />}
        {section === "popular" && <TeamTotals offers={offers} period="game" teams={teams} onPick={onPick} />}
        {section === "popular" && <LinesGrid offers={offers} period="h1" teams={teams} onPick={onPick} />}
        {section === "alt" && (
          <>
            <Ladder title="Alternate spread" offers={of("game", "spread")} kind="spread" teams={teams} onPick={onPick} />
            <Ladder title="Alternate total" offers={of("game", "total")} kind="total" teams={teams} onPick={onPick} />
            <Ladder title="1st Half alternate spread" offers={of("h1", "spread")} kind="spread" teams={teams} onPick={onPick} />
            <Ladder title="1st Half alternate total" offers={of("h1", "total")} kind="total" teams={teams} onPick={onPick} />
          </>
        )}
        {section === "teamTotals" && (
          <>
            <TeamTotals offers={offers} period="game" teams={teams} onPick={onPick} />
            <TeamTotals offers={offers} period="h1" teams={teams} onPick={onPick} />
            <TeamTotals offers={offers} period="q1" teams={teams} onPick={onPick} />
          </>
        )}
        {(section === "h1" || section === "h2") && (
          <>
            <LinesGrid offers={offers} period={section} teams={teams} onPick={onPick} />
            <TeamTotals offers={offers} period={section} teams={teams} onPick={onPick} />
          </>
        )}
        {section === "quarters" &&
          ["q1", "q2", "q3", "q4"].map((q) => (
            <div key={q} className="space-y-3">
              <LinesGrid offers={offers} period={q} teams={teams} onPick={onPick} />
              <TeamTotals offers={offers} period={q} teams={teams} onPick={onPick} />
            </div>
          ))}
      </div>

      {pickedOffer && picked && (
        <BetSheet
          offer={pickedOffer}
          sideKey={picked.side}
          onSide={(side) => setPicked({ id: pickedOffer.id, side })}
          teams={teams}
          sport={sport}
          matchId={matchId}
          matchLabel={matchLabel}
          onClose={close}
        />
      )}
    </div>
  );
}
