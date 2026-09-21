"use client";

/**
 * One NFL research game: schedule/status, the Elo model's pregame
 * projection (win probabilities + expected margin only — no totals, no
 * spread-cover/over-under, no picks/units/Kelly — see docs/architecture/
 * NFL-RESEARCH.md), and a manual market-line form for local, browser-only
 * disagreement comparison. Every instance of this card carries the
 * experimental/signal-only badge and the CLV-negative warning — never
 * conditionally hidden.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { compareToModel, validateAmericanOdds, validateSpread } from "@/lib/nfl/research/manualMarket";
import type { NflManualLineType } from "@/lib/nfl/research/manualMarket";
import type { NflGamePrediction } from "@/lib/nfl/research/predictionCapture";
import type { NflResearchGameStatus, NflScheduleGame } from "@/lib/nfl/research/espnSchedule";
import type { NflTeamIdentity } from "@/lib/nfl/research/teamIdentity";
import { useNflManualMarketEntry } from "./manualMarketStore";

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

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">{formatKickoff(game.startUtc)} ET</span>
          <div className="flex items-center gap-1.5">
            <Badge variant={game.status === "live" ? "destructive" : game.status === "final" ? "secondary" : "outline"}>
              {STATUS_LABEL[game.status]}
            </Badge>
            <Badge variant="outline" className="border-amber-400 text-amber-700 dark:border-amber-500 dark:text-amber-300">
              Experimental · signal-only
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Teams */}
        <div className="flex flex-col gap-2">
          {[
            { name: awayIdentity.espnName, score: game.awayScore, label: "Away" },
            { name: homeIdentity.espnName, score: game.homeScore, label: "Home" },
          ].map(({ name, score, label }) => (
            <div key={name} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">{name}</div>
                <div className="text-[11px] text-muted-foreground">{label}</div>
              </div>
              {score !== null ? <span className="font-mono text-sm tabular-nums text-foreground">{score}</span> : null}
            </div>
          ))}
        </div>

        {/* Projection */}
        <div className="rounded-lg bg-muted/40 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Pregame Elo projection
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Expected home margin {pts(prediction.expectedHomeMargin)}</span>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span>{homeIdentity.abbreviation} win {pct(prediction.homeWinProb)} (experimental estimate)</span>
            <span>{awayIdentity.abbreviation} win {pct(prediction.awayWinProb)} (experimental estimate)</span>
          </div>

          {/* Underlying Elo + sample */}
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>{homeIdentity.abbreviation} rating: {Math.round(prediction.homeRating)} ({prediction.homeGamesPlayed} games)</span>
            <span>{awayIdentity.abbreviation} rating: {Math.round(prediction.awayRating)} ({prediction.awayGamesPlayed} games)</span>
          </div>

          {prediction.warnings.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1">
              {prediction.warnings.map((w, i) => (
                <p
                  key={i}
                  className="rounded border border-amber-300/60 bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  ⚠ {w}
                </p>
              ))}
            </div>
          ) : null}

          <p className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
            This model is calibration-honest but historically loses to the closing line (negative CLV) — see
            docs/architecture/NFL-RESEARCH.md. It is not a proven edge, and no recommendation, unit, or pick is
            implied by anything on this page.
          </p>
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
              <Label htmlFor={`nfl-research-${game.espnEventId}-lineType`} className="text-[11px] uppercase tracking-wide text-muted-foreground">
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

          {comparison.marginDiff !== null || comparison.winProbDiff !== null ? (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {comparison.marginDiff !== null ? <span>Model vs. spread: {pts(comparison.marginDiff)} pts</span> : null}
              {comparison.marketHomeWinProb !== null ? (
                <span>
                  De-vigged market: {homeIdentity.abbreviation} {pct(comparison.marketHomeWinProb)} (model{" "}
                  {pct(Math.abs(comparison.winProbDiff!))} {comparison.winProbDiff! >= 0 ? "higher" : "lower"} than market)
                </span>
              ) : null}
              {entry.homeMoneyline !== null && entry.awayMoneyline === null ? (
                <span>Enter both moneylines to de-vig the market probability.</span>
              ) : null}
            </div>
          ) : null}
          {entry.enteredAt ? (
            <p className="mt-1 text-[10px] text-muted-foreground/70">
              Entered {new Date(entry.enteredAt).toLocaleString()} — self-reported, never verified against a real
              feed, and never used as CLV evidence.
            </p>
          ) : null}
          <p className="mt-1 text-[10px] text-muted-foreground/80">
            Research comparison only, uncalibrated and experimental — never a guaranteed edge, never a stake size.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
