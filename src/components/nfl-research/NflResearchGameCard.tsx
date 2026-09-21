"use client";

/**
 * One NFL research game — redesigned for presentation (see the task that
 * produced this revision). Every underlying number, warning, and disclosure
 * is byte-for-byte the same as before this pass; only layout/hierarchy/visual
 * treatment changed. No totals, no spread-cover/over-under probability, no
 * picks/units/Kelly — see docs/architecture/NFL-RESEARCH.md.
 *
 * Reuses the app's existing "premium matchup" pattern
 * (`src/app/games/[gameId]/page.tsx`'s symmetric team header + `WinProbBar`)
 * rather than inventing a new one, and the existing `<details>` disclosure
 * convention already used on `/deck` for secondary content.
 */
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { TeamBadge } from "@/components/TeamBadge";
import { WinProbBar } from "@/components/WinProbBar";
import { compareToModel, validateAmericanOdds, validateSpread } from "@/lib/nfl/research/manualMarket";
import type { NflManualLineType } from "@/lib/nfl/research/manualMarket";
import type { NflGamePrediction } from "@/lib/nfl/research/predictionCapture";
import type { NflResearchGameStatus, NflScheduleGame } from "@/lib/nfl/research/espnSchedule";
import type { NflTeamIdentity } from "@/lib/nfl/research/teamIdentity";
import { useNflManualMarketEntry } from "./manualMarketStore";
import { projectedLineLabel } from "./projectedLine";

const STATUS_LABEL: Record<NflResearchGameStatus, string> = {
  scheduled: "Scheduled",
  live: "Live",
  final: "Final",
  postponed: "Postponed",
  other: "Status unknown",
};

function formatKickoff(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
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

interface LineFieldProps {
  fieldId: string;
  label: string;
  value: number | null;
  onCommit: (raw: string) => void;
  placeholder: string;
}

/** One manual-line input, parsed/validated on blur (not on every keystroke) — mirrors CfbGameCard.tsx's LineField. `fieldId` must be unique page-wide. */
function LineField({ fieldId, label, value, onCommit, placeholder }: LineFieldProps) {
  const [draft, setDraft] = useState<string>(value === null ? "" : String(value));
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={fieldId} className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <Input
        id={fieldId}
        inputMode="decimal"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        className="h-9 text-sm"
      />
    </div>
  );
}

interface NflResearchGameCardProps {
  game: NflScheduleGame;
  homeIdentity: NflTeamIdentity;
  awayIdentity: NflTeamIdentity;
  prediction: NflGamePrediction;
}

export function NflResearchGameCard({ game, homeIdentity, awayIdentity, prediction }: NflResearchGameCardProps) {
  const { entry, setEntry, clear } = useNflManualMarketEntry(game.espnEventId);

  function commitNumber(field: "homeSpread" | "awaySpread" | "homeMoneyline" | "awayMoneyline", validator: (raw: unknown) => number | null, raw: string) {
    setEntry({ ...entry, [field]: raw.trim() === "" ? null : validator(raw) });
  }

  function commitLineType(raw: string) {
    const lineType: NflManualLineType | null = raw === "current" || raw === "closing" ? raw : null;
    setEntry({ ...entry, lineType });
  }

  function commitSource(raw: string) {
    setEntry({ ...entry, source: raw.trim() === "" ? null : raw.trim() });
  }

  const comparison = compareToModel(entry, prediction);
  const hasManualEntry = entry.homeSpread !== null || entry.homeMoneyline !== null || entry.awayMoneyline !== null || entry.awaySpread !== null;
  const lineLabel = projectedLineLabel(homeIdentity.abbreviation, awayIdentity.abbreviation, prediction.expectedHomeMargin);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {/* Kickoff + status */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">{formatKickoff(game.startUtc)} ET</span>
          <Badge variant={game.status === "live" ? "destructive" : game.status === "final" ? "secondary" : "outline"}>
            {STATUS_LABEL[game.status]}
          </Badge>
        </div>

        {/* Symmetric matchup header — mirrors the app's existing MLB game-detail pattern */}
        <div className="flex items-center justify-center gap-4 rounded-xl bg-muted/30 px-3 py-4 sm:gap-8 sm:px-4 sm:py-5">
          <div className="flex flex-1 flex-col items-center gap-2 text-center">
            <TeamBadge abbreviation={awayIdentity.abbreviation} name={awayIdentity.espnName} size={44} />
            <span className="text-xs font-semibold text-foreground sm:text-sm">{awayIdentity.espnName}</span>
            {game.awayScore !== null ? (
              <span className="font-mono text-xl font-bold text-foreground">{game.awayScore}</span>
            ) : null}
          </div>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">@</span>
          <div className="flex flex-1 flex-col items-center gap-2 text-center">
            <TeamBadge abbreviation={homeIdentity.abbreviation} name={homeIdentity.espnName} size={44} />
            <span className="text-xs font-semibold text-foreground sm:text-sm">{homeIdentity.espnName}</span>
            {game.homeScore !== null ? (
              <span className="font-mono text-xl font-bold text-foreground">{game.homeScore}</span>
            ) : null}
          </div>
        </div>

        {/* Win probability — large, immediately visible, accessible text labels (not color-only) */}
        <WinProbBar
          awayAbbr={awayIdentity.abbreviation}
          homeAbbr={homeIdentity.abbreviation}
          awayProb={prediction.awayWinProb}
          homeProb={prediction.homeWinProb}
        />

        {/* Projection summary */}
        <div className="text-center">
          <p className="text-base font-semibold text-foreground sm:text-lg">
            ARCHR projected line: <span className="font-mono">{lineLabel}</span>
          </p>
          <p className="text-[10px] text-muted-foreground">Expected margin — not a validated cover probability</p>
        </div>

        {/* Concise, always-visible CLV note — one line, no giant box */}
        <p className="flex items-center justify-center gap-1.5 text-center text-[10px] text-amber-700 dark:text-amber-400">
          <span aria-hidden>⚠</span> Experimental model — historically loses to the closing line, not a proven edge
        </p>

        {prediction.warnings.length > 0 ? (
          <div className="flex flex-col gap-1">
            {prediction.warnings.map((w, i) => (
              <p key={i} className="text-center text-[10px] text-amber-700 dark:text-amber-400">
                ⚠ {w}
              </p>
            ))}
          </div>
        ) : null}

        {/* Elo ratings / sample size — secondary, expandable */}
        <details className="rounded-lg border border-border text-xs text-muted-foreground open:pb-2">
          <summary className="cursor-pointer select-none px-3 py-1.5 font-medium text-foreground">
            Matchup details — Elo ratings &amp; sample size
          </summary>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-3">
            <span>
              {awayIdentity.abbreviation} rating: {Math.round(prediction.awayRating)} ({prediction.awayGamesPlayed} games)
            </span>
            <span>
              {homeIdentity.abbreviation} rating: {Math.round(prediction.homeRating)} ({prediction.homeGamesPlayed} games)
            </span>
          </div>
        </details>

        {/* Manual market entry — sportsbook-style row */}
        <div className="border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Market lines</span>
            <Button variant="ghost" size="xs" onClick={clear}>
              Clear
            </Button>
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground/80">Entered manually, saved only in this browser</p>

          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <LineField
              fieldId={`nfl-research-${game.espnEventId}-homeSpread`}
              label={`${homeIdentity.abbreviation} spread`}
              value={entry.homeSpread}
              placeholder="-3.5"
              onCommit={(raw) => commitNumber("homeSpread", validateSpread, raw)}
            />
            <LineField
              fieldId={`nfl-research-${game.espnEventId}-awaySpread`}
              label={`${awayIdentity.abbreviation} spread`}
              value={entry.awaySpread}
              placeholder="+3.5"
              onCommit={(raw) => commitNumber("awaySpread", validateSpread, raw)}
            />
            <LineField
              fieldId={`nfl-research-${game.espnEventId}-homeMoneyline`}
              label={`${homeIdentity.abbreviation} ML`}
              value={entry.homeMoneyline}
              placeholder="-150"
              onCommit={(raw) => commitNumber("homeMoneyline", validateAmericanOdds, raw)}
            />
            <LineField
              fieldId={`nfl-research-${game.espnEventId}-awayMoneyline`}
              label={`${awayIdentity.abbreviation} ML`}
              value={entry.awayMoneyline}
              placeholder="+130"
              onCommit={(raw) => commitNumber("awayMoneyline", validateAmericanOdds, raw)}
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`nfl-research-${game.espnEventId}-lineType`} className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Line type
              </Label>
              <select
                id={`nfl-research-${game.espnEventId}-lineType`}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                value={entry.lineType ?? ""}
                onChange={(e) => commitLineType(e.target.value)}
              >
                <option value="">Unspecified</option>
                <option value="current">Current</option>
                <option value="closing">Closing (self-reported)</option>
              </select>
            </div>
            <LineField
              fieldId={`nfl-research-${game.espnEventId}-source`}
              label="Source / book"
              value={null}
              placeholder="e.g. DraftKings"
              onCommit={commitSource}
            />
          </div>

          {entry.enteredAt ? (
            <p className="mt-1.5 text-[10px] text-muted-foreground/70">
              Manually entered {new Date(entry.enteredAt).toLocaleString()}
              {entry.source ? ` · ${entry.source}` : ""}
              {entry.lineType ? ` · labeled "${entry.lineType}"` : ""} — self-reported, never verified.
            </p>
          ) : null}

          {hasManualEntry ? (
            <div className="mt-3 rounded-lg bg-muted/40 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Model vs. market disagreement
              </p>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                {comparison.marketHomeWinProb !== null ? (
                  <>
                    <dt className="text-muted-foreground">Market de-vigged probability</dt>
                    <dd className="text-right font-mono text-foreground">
                      {homeIdentity.abbreviation} {pct(comparison.marketHomeWinProb)}
                    </dd>
                    <dt className="text-muted-foreground">ARCHR probability</dt>
                    <dd className="text-right font-mono text-foreground">
                      {homeIdentity.abbreviation} {pct(prediction.homeWinProb)}
                    </dd>
                    <dt className="text-muted-foreground">Probability disagreement</dt>
                    <dd className="text-right font-mono text-foreground">
                      {pct(Math.abs(comparison.winProbDiff!))} {comparison.winProbDiff! >= 0 ? "higher" : "lower"}
                    </dd>
                  </>
                ) : entry.homeMoneyline !== null || entry.awayMoneyline !== null ? (
                  <p className="col-span-2 text-muted-foreground">Enter both moneylines to de-vig the market probability.</p>
                ) : null}
                <dt className="text-muted-foreground">ARCHR expected margin</dt>
                <dd className="text-right font-mono text-foreground">{pts(prediction.expectedHomeMargin)}</dd>
                {comparison.marginDiff !== null ? (
                  <>
                    <dt className="text-muted-foreground">Entered market spread</dt>
                    <dd className="text-right font-mono text-foreground">{pts(-entry.homeSpread!)}</dd>
                    <dt className="text-muted-foreground">Margin disagreement</dt>
                    <dd className="text-right font-mono text-foreground">{pts(comparison.marginDiff)}</dd>
                  </>
                ) : null}
              </dl>
              <p className="mt-2 text-[10px] text-muted-foreground/80">
                A transparent difference only — never called an edge, CLV, a recommendation, or a cover probability.
              </p>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
