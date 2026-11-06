"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { findParlays, findTwoTeamParlays, type FinderLeg, type FoundParlay, type TwoTeamParlay } from "@/lib/props/parlayFinder";
import { findStacks, type StackRank } from "@/lib/props/stackFinder";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { ParlayTray } from "@/components/props/Parlay";
import type { ParlayLeg } from "@/lib/props/parlay";
import { EmptyList, GameChips, ListNote, Segmented, chip, type ChipTeam } from "@/components/props/kit";
import { ScrollRow } from "@/components/ScrollRow";

const pct = (p: number) => `${Math.round(p * 100)}%`;

type SeasonsKey = "both" | "this";
type ShortestKey = "-300" | "-500" | "-1000" | "any";
type LegRateKey = "0.6" | "0.7" | "0.8";
type PerPlayerKey = "1" | "2" | "any";
type TeamsKey = "one" | "both" | "pick";
/** Players a stack can hold. */
const MAX_PICKED = 8;
type SidesKey = "all" | "over" | "under";

export interface FinderGame {
  id: string;
  away: ChipTeam;
  home: ChipTeam;
  start: string;
}

const legText = (l: FinderLeg) => (l.sideLabel === "Yes" || l.sideLabel === "No" ? `${l.statShort} ${l.sideLabel}` : `${l.sideLabel} ${l.point} ${l.statShort}`);

/** The legs, each with its own record in the games the combination is counted over. */
function LegList({ p }: { p: FoundParlay }) {
  return (
    <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
      {p.legs.map((l, i) => (
        <li key={l.key} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
          <span className="min-w-0 truncate">
            <span className="font-semibold text-foreground">{l.playerName}</span> <span className="text-muted-foreground">{legText(l)}</span>
          </span>
          <span className="flex shrink-0 items-center gap-3 font-mono text-muted-foreground">
            <span title="This leg on its own, in the same games">
              {p.legHits[i]}/{p.shared}
            </span>
            <span className="min-w-12 text-right text-foreground">{l.priceAmerican !== null ? formatAmerican(l.priceAmerican) : "—"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function PriceLine({ priceAmerican, model }: { priceAmerican: number | null; model: number | null }) {
  if (priceAmerican === null && model === null) return null;
  return (
    <p className="mt-2 text-[11px] text-muted-foreground">
      {priceAmerican !== null && (
        <>
          Legs&apos; prices multiplied: <span className="font-mono text-foreground">{formatAmerican(priceAmerican)}</span>
        </>
      )}
      {priceAmerican !== null && model !== null && " · "}
      {model !== null && (
        <>
          ARCHR&apos;s chance tonight: <span className="font-mono text-foreground">{pct(model)}</span>
        </>
      )}{" "}
      (each as if the legs were unrelated)
    </p>
  );
}

function ParlayCard({ p, span, onOpen }: { p: FoundParlay; span: string; onOpen: () => void }) {
  const players = new Set(p.legs.map((l) => l.player)).size;
  return (
    <li className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-foreground">
          Every leg hit in <span className="font-mono font-semibold">{p.hits}</span> of {p.shared} games
        </p>
        <span className="font-mono text-lg font-bold text-emerald-600 dark:text-emerald-400">{pct(p.hits / p.shared)}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        The {p.shared} games {span} where {players === 1 ? "this player played" : `all ${players} players played`}; in {p.hits} of them every leg cashed in that same game. Last{" "}
        {p.last10.shared} of those: <span className="font-mono">{p.last10.hits}/{p.last10.shared}</span>.
      </p>
      <LegList p={p} />
      <PriceLine priceAmerican={p.priceAmerican} model={p.model} />
      <button type="button" onClick={onOpen} className="mt-2 text-xs font-semibold text-foreground underline-offset-2 hover:underline">
        Game by game →
      </button>
    </li>
  );
}

function TwoTeamCard({ p, span, onOpen }: { p: TwoTeamParlay; span: string; onOpen: () => void }) {
  return (
    <li className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-foreground">Both sides cashing, estimated</p>
        <span className="font-mono text-lg font-bold text-emerald-600 dark:text-emerald-400">{pct(p.estimate)}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {p.sides.map((s) => `${s.team} side ${pct(s.parlay.hits / s.parlay.shared)}`).join(" × ")}: each team&apos;s legs hit together this often in that team&apos;s games {span}.
      </p>
      {p.sides.map((s) => (
        <div key={s.team} className="mt-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {s.team} side · every leg hit in <span className="font-mono text-foreground">{s.parlay.hits}</span> of {s.parlay.shared} {s.team} games
          </p>
          <LegList p={s.parlay} />
        </div>
      ))}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {p.h2h.shared > 0 ? (
          <>
            When these teams met {span}: every leg hit in <span className="font-mono text-foreground">{p.h2h.hits}/{p.h2h.shared}</span>
          </>
        ) : (
          <>These teams haven&apos;t met {span}</>
        )}
      </p>
      <PriceLine priceAmerican={p.priceAmerican} model={p.model} />
      <button type="button" onClick={onOpen} className="mt-2 text-xs font-semibold text-foreground underline-offset-2 hover:underline">
        Open in the parlay lab →
      </button>
    </li>
  );
}

/**
 * Pick players: tap 2–8 players, and the finder returns the line for each that
 * cashed together most often in the games they all played (or, ranked by
 * payout, the longest-priced stacks that cashed 70%+ of the time).
 */
function PickPlayers({
  roster,
  picked,
  onToggle,
  onClear,
  stack,
  span,
  rank,
  onOpen,
}: {
  roster: { team: string; players: { id: string; name: string; lines: number }[] }[];
  picked: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  stack: ReturnType<typeof findStacks> | null;
  span: string;
  rank: StackRank;
  onOpen: (legs: FinderLeg[]) => void;
}) {
  const teamsPicked = new Set(roster.filter((t) => t.players.some((p) => picked.includes(p.id))).map((t) => t.team));
  return (
    <>
      <ListNote>
        Tap {picked.length ? "more players" : "2 to 8 players"} ({picked.length}/{MAX_PICKED} picked). The finder looks for the line on each of them that cashed together most
        often in the games they all played {span}.
        {picked.length > 0 && (
          <>
            {" "}
            <button type="button" onClick={onClear} className="font-semibold text-foreground underline-offset-2 hover:underline">
              Clear
            </button>
          </>
        )}
      </ListNote>
      {roster.map(({ team, players }) => (
        <div key={team} className="mt-2.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{team}</p>
          <div className="flex flex-wrap gap-2">
            {players.map((p) => (
              <button key={p.id} type="button" onClick={() => onToggle(p.id)} className={chip(picked.includes(p.id))} aria-pressed={picked.includes(p.id)}>
                {p.name} <span className="opacity-60">{p.lines}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {teamsPicked.size > 1 && (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">Players from both teams only share the games these teams played each other, so the record will be short.</p>
      )}
      {stack && (
        <p className="mt-3 text-xs text-muted-foreground">
          They played <span className="font-mono text-foreground">{stack.together}</span> games together {span}
          {stack.stacks.length > 0 && (rank === "payout" ? " · the longest-priced stacks that cashed 70%+ of them" : " · the stacks that cashed together most often")}
        </p>
      )}
      {stack && stack.stacks.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2.5">
          {stack.stacks.map((p) => (
            <ParlayCard key={p.legs.map((l) => l.key).join("|")} p={p} span={span} onOpen={() => onOpen(p.legs)} />
          ))}
        </ul>
      ) : stack ? (
        <EmptyList
          title={stack.together < 5 ? `Only ${stack.together} games together ${span}` : rank === "payout" ? "No stack of these players cashed 70%+ together" : "No stack of lines on these players cashed together"}
          hint={stack.together < 5 ? "Pick players who've shared the floor more, or include last season." : "Try ranking by hit rate, allow shorter-priced legs, or include unders."}
        />
      ) : null}
    </>
  );
}

function HowToRead({ both }: { both: boolean }) {
  return (
    <details className="mt-3 rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground [&_summary::-webkit-details-marker]:hidden">
      <summary className="cursor-pointer list-none font-semibold text-foreground">How to read these ▾</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4 leading-relaxed">
        <li>
          <span className="text-foreground">Games counted</span>{" "}are the games where every player in the parlay played. Teammates share most games; players on
          opposite teams only share the games their teams played each other.
        </li>
        <li>
          <span className="text-foreground">Every leg hit</span>{" "}means all the legs cashed in the same game. 18 of 24 means in 18 of those 24 games, the whole
          parlay would have won at tonight&apos;s numbers.
        </li>
        <li>
          Each leg&apos;s <span className="text-foreground">own record</span>{" "}(like 20/24) is that leg alone, in the same games. Legs that move together keep the
          parlay&apos;s record close to its weakest leg&apos;s.
        </li>
        {both && (
          <li>
            <span className="text-foreground">Both teams</span>: each team&apos;s legs are counted in that team&apos;s games, then the two records are multiplied
            for the estimate. When the teams have met, how the whole parlay did in those games is shown too.
          </li>
        )}
        <li>
          The finder tries thousands of combinations, so some records are partly luck. ARCHR&apos;s chance beside each one is the model&apos;s read for tonight.
        </li>
      </ul>
    </details>
  );
}

/**
 * The parlay finder, any sport: pick a game, and it searches every line the
 * books hang on it (alt rungs included) for the same-game combinations, 2 legs
 * to 15, whose legs have all cashed together most often. Each opens in the
 * parlay lab for the game-by-game table. The sport supplies its games and how
 * to turn a game's lines into legs.
 */
export function ParlayFinder({
  games,
  season,
  legsFor,
  minShared,
}: {
  games: FinderGame[];
  season: number;
  /** Every leg on one game, skipping legs priced shorter than `shortestPrice`. */
  legsFor: (gameId: string, shortestPrice: number) => FinderLeg[];
  /** Shared games a record needs: over both seasons, and this season only. */
  minShared: { both: number; this: number };
}) {
  const [gameId, setGameId] = useState<string | null>(games[0]?.id ?? null);
  const [seasons, setSeasons] = useState<SeasonsKey>("both");
  const [shortest, setShortest] = useState<ShortestKey>("-500");
  const [legRate, setLegRate] = useState<LegRateKey>("0.6");
  const [perPlayer, setPerPlayer] = useState<PerPlayerKey>("1");
  const [teams, setTeams] = useState<TeamsKey>("one");
  const [sides, setSides] = useState<SidesKey>("all");
  const [size, setSize] = useState<number | null>(null);
  const [lab, setLab] = useState<ParlayLeg[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [rank, setRank] = useState<StackRank>("rate");

  const allLegs = useMemo(() => (gameId ? legsFor(gameId, shortest === "any" ? -Infinity : Number(shortest)) : []), [legsFor, gameId, shortest]);
  // Overs only, unders only, or both (a Yes leg, like an anytime TD, counts as an over).
  const legs = useMemo(() => (sides === "all" ? allLegs : allLegs.filter((l) => l.side === sides)), [allLegs, sides]);
  const options = useMemo(
    () => ({
      minLegRate: Number(legRate),
      seasons: seasons === "this" ? [season] : [season, season - 1],
      minShared: seasons === "this" ? minShared.this : minShared.both,
      maxPerPlayer: perPlayer === "any" ? Infinity : Number(perPlayer),
    }),
    [legRate, seasons, season, minShared, perPlayer]
  );
  const oneTeam = useMemo(() => (teams === "one" ? findParlays(legs, options) : []), [teams, legs, options]);
  const twoTeam = useMemo(() => (teams === "both" ? findTwoTeamParlays(legs, options) : []), [teams, legs, options]);
  // Pick players: every player with a line on this game, by team.
  const roster = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; team: string; lines: number }>();
    for (const l of allLegs) {
      const p = byId.get(l.player) ?? byId.set(l.player, { id: l.player, name: l.playerName, team: l.team, lines: 0 }).get(l.player)!;
      p.lines++;
    }
    const players = [...byId.values()].sort((a, b) => a.team.localeCompare(b.team) || b.lines - a.lines || a.name.localeCompare(b.name));
    return [...new Set(players.map((p) => p.team))].map((team) => ({ team, players: players.filter((p) => p.team === team) }));
  }, [allLegs]);
  const stack = useMemo(
    () =>
      teams === "pick" && picked.length >= 2
        ? findStacks(legs, picked, { seasons: options.seasons, minShared: Math.min(options.minShared, 5), rank })
        : null,
    [teams, picked, legs, options, rank]
  );
  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_PICKED ? p : [...p, id]));
  const results: { size: number }[] = teams === "one" ? oneTeam : twoTeam;
  const span = seasons === "this" ? "this season" : "this season and last";
  const sizes = results.map((r) => r.size);
  const pick = <T extends { size: number }>(list: T[]) => list.find((r) => r.size === size) ?? list.find((r) => r.size === 4) ?? list[0];
  const shownOne = pick(oneTeam);
  const shownTwo = pick(twoTeam);
  const shown = teams === "one" ? shownOne : shownTwo;

  return (
    <>
      <GameChips
        games={games}
        active={gameId}
        onSelect={(id) => {
          if (!id) return;
          setGameId(id);
          setPicked([]);
        }}
        allLabel="Pick a game"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Segmented<TeamsKey>
          options={[
            { key: "one", label: "One team" },
            { key: "both", label: "Both teams" },
            { key: "pick", label: "Pick players" },
          ]}
          value={teams}
          onChange={setTeams}
        />
        <Segmented<SidesKey>
          options={[
            { key: "all", label: "Overs + unders" },
            { key: "over", label: "Overs only" },
            { key: "under", label: "Unders only" },
          ]}
          value={sides}
          onChange={setSides}
        />
        {teams === "pick" ? (
          <Segmented<StackRank>
            options={[
              { key: "rate", label: "Hit most often" },
              { key: "payout", label: "Best payout (70%+)" },
            ]}
            value={rank}
            onChange={setRank}
          />
        ) : (
        <Segmented<PerPlayerKey>
          options={[
            { key: "1", label: "1 leg per player" },
            { key: "2", label: "Up to 2" },
            { key: "any", label: "Any" },
          ]}
          value={perPlayer}
          onChange={setPerPlayer}
        />
        )}
        <Segmented<SeasonsKey>
          options={[
            { key: "both", label: "This + last season" },
            { key: "this", label: "This season" },
          ]}
          value={seasons}
          onChange={setSeasons}
        />
        {teams !== "pick" && (
        <Segmented<LegRateKey>
          options={[
            { key: "0.6", label: "Legs 60%+" },
            { key: "0.7", label: "70%+" },
            { key: "0.8", label: "80%+" },
          ]}
          value={legRate}
          onChange={setLegRate}
        />
        )}
        <Segmented<ShortestKey>
          options={[
            { key: "-300", label: "No legs under −300" },
            { key: "-500", label: "−500" },
            { key: "-1000", label: "−1000" },
            { key: "any", label: "Any" },
          ]}
          value={shortest}
          onChange={setShortest}
        />
      </div>

      {teams === "pick" ? (
        <PickPlayers
          roster={roster}
          picked={picked}
          onToggle={togglePick}
          onClear={() => setPicked([])}
          stack={stack}
          span={span}
          rank={rank}
          onOpen={(legs) => setLab(legs)}
        />
      ) : (
      <>
      {sizes.length > 0 && (
        <ScrollRow className="-mx-4 mt-3 flex gap-2 px-4 pb-1">
          {sizes.map((n) => (
            <button key={n} type="button" onClick={() => setSize(n)} className={chip(n === shown?.size)}>
              {n} legs
            </button>
          ))}
        </ScrollRow>
      )}

      <ListNote>
        {legs.length} {sides === "all" ? "" : sides === "over" ? "over " : "under "}lines on this game
        {shown
          ? teams === "one"
            ? ` · the best ${shown.size}-leg combinations by how often every leg cashed in the same game`
            : ` · the best ${shown.size}-leg parlays with legs on both teams`
          : ""}
      </ListNote>
      <HowToRead both={teams === "both"} />

      {teams === "one" && shownOne ? (
        <ul className="mt-3 flex flex-col gap-2.5">
          {shownOne.parlays.map((p) => (
            <ParlayCard key={p.legs.map((l) => l.key).join("|")} p={p} span={span} onOpen={() => setLab(p.legs)} />
          ))}
        </ul>
      ) : teams === "both" && shownTwo ? (
        <ul className="mt-3 flex flex-col gap-2.5">
          {shownTwo.parlays.map((p) => (
            <TwoTeamCard key={p.legs.map((l) => l.key).join("|")} p={p} span={span} onOpen={() => setLab(p.legs)} />
          ))}
        </ul>
      ) : (
        <EmptyList
          title={teams === "both" ? "No two-team parlay clears these bars" : "No combination has cashed together often enough"}
          hint="Try a lower leg hit rate, allow shorter-priced legs, more legs per player, or include last season."
        />
      )}
      </>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        One player&apos;s stats nearly always hit together, so the finder starts at one leg per player; allow more to see those. Books price same-game parlays
        below the legs&apos; prices multiplied when legs move together. Research only.{" "}
        <Link href="/parlay-builder" className="font-semibold text-foreground underline-offset-2 hover:underline">
          Build across games and sports →
        </Link>
      </p>
      <ParlayTray legs={lab} season={season} onRemove={(id) => setLab((l) => l.filter((x) => x.id !== id))} onClear={() => setLab([])} />
    </>
  );
}
