"use client";

/**
 * One CFB v0 game: schedule/status, the baseline model's projection, the
 * "why" panel (the projection's named drivers), and a manual market-line
 * form for local, browser-only research comparison. No "best bet"/"lock"/
 * "official pick" language anywhere — see docs/architecture/CFB-V0.md.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { compareToModel, validateAmericanOdds, validateSpread, validateTotal } from "@/lib/cfb/manualMarket";
import type { CfbGamePrediction, CfbGameStatus, CfbTeamRef, ManualMarketEntry } from "@/lib/cfb/types";
import { useManualMarketEntry } from "./manualMarketStore";
import { resyncDraft } from "./lineFieldSync";

const STATUS_LABEL: Record<CfbGameStatus, string> = {
  scheduled: "Scheduled",
  live: "Live",
  final: "Final",
  postponed: "Postponed",
  other: "Status unknown",
};

function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

function initialsFor(name: string): string {
  const words = name.split(" ").filter(Boolean);
  return (words.at(-1)?.slice(0, 2) ?? name.slice(0, 2)).toUpperCase();
}

function TeamBadgeCfb({ team }: { team: CfbTeamRef }) {
  const hue = hueFor(team.espnTeamId);
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
      style={{ backgroundColor: `hsl(${hue} 55% 40%)` }}
      aria-hidden
    >
      {initialsFor(team.displayName)}
    </span>
  );
}

function formatKickoff(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(date);
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function pts(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

interface CfbGameCardProps {
  espnEventId: string;
  startUtc: Date;
  status: CfbGameStatus;
  neutralSite: boolean;
  home: CfbTeamRef;
  away: CfbTeamRef;
  homeScore: number | null;
  awayScore: number | null;
  /** Always present — a team with zero completed games yet gets a league-average default rating (see ratingOrDefault in ratings.ts), so the projection just reads low-confidence pick'em rather than being hidden. */
  prediction: CfbGamePrediction;
}

/**
 * One manual-line input, parsed/validated on blur so an in-progress keystroke
 * (e.g. "-") isn't rejected mid-type. `fieldId` must be unique across the
 * WHOLE page (not just this card) — every game on the board renders its own
 * set of these, and a team abbreviation alone can repeat or be absent (ESPN
 * doesn't always supply one, falling back to the literal "Home"/"Away"),
 * which would otherwise produce duplicate `id`s across different games'
 * cards on the same `/cfb` page — invalid HTML, and it breaks the
 * label/input association for assistive tech.
 *
 * The typed `draft` and the committed `value` prop are deliberately two
 * separate pieces of state (so a keystroke isn't validated/rejected
 * mid-type), but they must still track each other whenever `value` changes
 * for a reason OTHER than this field's own typing — Clear, a store update
 * hydrating from `localStorage` after mount, or a cross-tab `storage` event.
 * Re-syncing only in a `useEffect` would show a stale value for one extra
 * render (a visible flash of wrong data); instead this compares against the
 * value `draft` was last synced FROM, during render itself (the pattern
 * React's own docs recommend for exactly this "adjust state when a prop
 * changes" case) — it fires only when `value` itself actually moves, so it
 * never fights an in-progress, uncommitted keystroke. The decision itself is
 * `resyncDraft` (./lineFieldSync.ts) — pulled out pure so it's unit-testable
 * without a DOM.
 */
function LineField({
  fieldId,
  label,
  value,
  onCommit,
  placeholder,
}: {
  fieldId: string;
  label: string;
  value: number | null;
  onCommit: (raw: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState<string>(value === null ? "" : String(value));
  const [syncedValue, setSyncedValue] = useState(value);
  const resync = resyncDraft(value, syncedValue);
  if (resync) {
    setSyncedValue(resync.syncedValue);
    setDraft(resync.draft);
  }
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={fieldId} className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <Input
        id={fieldId}
        inputMode="decimal"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
      />
    </div>
  );
}

export function CfbGameCard({
  espnEventId,
  startUtc,
  status,
  neutralSite,
  home,
  away,
  homeScore,
  awayScore,
  prediction,
}: CfbGameCardProps) {
  const { entry, setEntry, clear } = useManualMarketEntry(espnEventId);

  function commit(field: keyof ManualMarketEntry, validator: (raw: unknown) => number | null, raw: string) {
    const next: ManualMarketEntry = { ...entry, [field]: raw.trim() === "" ? null : validator(raw) };
    setEntry(next);
  }

  const comparison = compareToModel(entry, prediction);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {formatKickoff(startUtc)} ET{neutralSite ? " · Neutral site" : ""}
          </span>
          <Badge variant={status === "live" ? "destructive" : status === "final" ? "secondary" : "outline"}>
            {STATUS_LABEL[status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Teams */}
        <div className="flex flex-col gap-2">
          {[
            { team: away, score: awayScore, site: neutralSite ? "" : "Away" },
            { team: home, score: homeScore, site: neutralSite ? "" : "Home" },
          ].map(({ team, score, site }) => (
            <div key={team.espnTeamId} className="flex items-center gap-2">
              <TeamBadgeCfb team={team} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">{team.displayName}</div>
                <div className="text-[11px] text-muted-foreground">
                  {team.record ? `${team.record} overall` : "Record unavailable"}
                  {site ? ` · ${site}` : ""}
                </div>
              </div>
              {score !== null ? <span className="font-mono text-sm tabular-nums text-foreground">{score}</span> : null}
            </div>
          ))}
        </div>

        {/* Projection */}
        <div className="rounded-lg bg-muted/40 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {status === "scheduled" ? "Model projection" : "Pregame model projection"}
            </span>
            <Badge variant="outline" className="text-[10px]">
              {prediction.confidence} confidence
            </Badge>
          </div>
          {status !== "scheduled" ? (
            <p className="mt-0.5 text-[10px] text-muted-foreground/80">
              This game is {STATUS_LABEL[status].toLowerCase()} — the numbers below are the model&apos;s pregame
              estimate, not a live update.
            </p>
          ) : null}
          <div className="mt-1.5 flex items-center justify-between text-sm">
            <span className="font-mono tabular-nums text-foreground">
              {away.abbreviation ?? "Away"} {prediction.projectedAwayScore.toFixed(1)} — {home.abbreviation ?? "Home"}{" "}
              {prediction.projectedHomeScore.toFixed(1)}
            </span>
            <span className="text-muted-foreground">
              Margin {pts(prediction.projectedMargin)} · Total {prediction.projectedTotal.toFixed(1)}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              {home.abbreviation ?? "Home"} win {pct(prediction.homeWinProb)} (experimental estimate)
            </span>
            <span>
              {away.abbreviation ?? "Away"} win {pct(prediction.awayWinProb)} (experimental estimate)
            </span>
          </div>
          {prediction.confidence === "low" ? (
            <p className="mt-1.5 rounded border border-amber-300/60 bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-200">
              ⚠ Small sample — only {prediction.drivers.minGamesPlayed} completed game
              {prediction.drivers.minGamesPlayed === 1 ? "" : "s"} behind the lesser-tracked team. Treat this
              percentage as a rough placeholder, not a validated probability.
            </p>
          ) : null}

          {/* Why panel */}
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-3">
            <span>Offense edge: {pts(prediction.drivers.offenseEdge)}</span>
            <span>Defense edge: {pts(prediction.drivers.defenseEdge)}</span>
            <span>Schedule edge: {pts(prediction.drivers.scheduleStrengthEdge)}</span>
            <span>Home field: {pts(prediction.drivers.homeFieldPoints)}</span>
            <span>Min. sample: {prediction.drivers.minGamesPlayed} games</span>
          </div>
        </div>

        {/* Manual market entry */}
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Market lines (entered manually, saved only in this browser)
            </span>
            <Button variant="ghost" size="xs" onClick={clear}>
              Clear
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <LineField
              fieldId={`cfb-${espnEventId}-homeSpread`}
              label={`${home.abbreviation ?? "Home"} spread`}
              value={entry.homeSpread}
              placeholder="-3.5"
              onCommit={(raw) => commit("homeSpread", validateSpread, raw)}
            />
            <LineField
              fieldId={`cfb-${espnEventId}-marketTotal`}
              label="Total"
              value={entry.marketTotal}
              placeholder="54.5"
              onCommit={(raw) => commit("marketTotal", validateTotal, raw)}
            />
            <LineField
              fieldId={`cfb-${espnEventId}-homeMoneyline`}
              label={`${home.abbreviation ?? "Home"} ML`}
              value={entry.homeMoneyline}
              placeholder="-150"
              onCommit={(raw) => commit("homeMoneyline", validateAmericanOdds, raw)}
            />
            <LineField
              fieldId={`cfb-${espnEventId}-awayMoneyline`}
              label={`${away.abbreviation ?? "Away"} ML`}
              value={entry.awayMoneyline}
              placeholder="+130"
              onCommit={(raw) => commit("awayMoneyline", validateAmericanOdds, raw)}
            />
          </div>

          {comparison.spreadDiff !== null ||
          comparison.totalDiff !== null ||
          comparison.winProbDiff !== null ||
          comparison.homeCoverProb !== null ||
          comparison.overProb !== null ? (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {comparison.spreadDiff !== null ? <span>Model vs. spread: {pts(comparison.spreadDiff)} pts</span> : null}
              {comparison.homeCoverProb !== null ? (
                <span>
                  Experimental cover est.: {home.abbreviation ?? "Home"} {pct(comparison.homeCoverProb)} /{" "}
                  {away.abbreviation ?? "Away"} {pct(comparison.awayCoverProb!)}
                </span>
              ) : null}
              {comparison.totalDiff !== null ? <span>Model vs. total: {pts(comparison.totalDiff)} pts</span> : null}
              {comparison.overProb !== null ? (
                <span>
                  Experimental O/U est.: Over {pct(comparison.overProb)} / Under {pct(comparison.underProb!)}
                </span>
              ) : null}
              {comparison.marketHomeWinProb !== null ? (
                <span>
                  De-vigged market: {home.abbreviation ?? "Home"} {pct(comparison.marketHomeWinProb)} (model{" "}
                  {pct(Math.abs(comparison.winProbDiff!))} {comparison.winProbDiff! >= 0 ? "higher" : "lower"} than
                  market)
                </span>
              ) : null}
              {entry.homeMoneyline !== null && entry.awayMoneyline === null ? (
                <span>Enter both moneylines to de-vig the market probability.</span>
              ) : null}
            </div>
          ) : null}
          <p className="mt-1 text-[10px] text-muted-foreground/80">
            Research comparison only, uncalibrated and experimental — not a guaranteed edge, not a stake size, and a
            continuous model can&apos;t represent a push at an exact line.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
