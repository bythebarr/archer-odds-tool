import type { Metadata } from "next";
import type { ReactNode } from "react";
import { previewDailyCard } from "@/lib/discord/postCard";
import {
  getMorningData,
  renderMorningDrop,
  lessonForDate,
  renderTeachingDrop,
} from "@/lib/discord/mosesDaily";
import { todayEt } from "@/lib/dateEt";
import { PageShell, PageHeader } from "@/components/PageShell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

// The card is assembled from today's live pool + fight-math model, so it changes
// through the day as lines move and results settle — never cache it.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Discord card preview",
  description: "Dry-run of exactly what the daily Discord card would post right now — no post, no spam.",
};

/**
 * Render a Discord embed-description line into JSX, honoring the small markdown
 * subset the card actually emits: `code`, **bold**, _italic_. Faithful to what
 * Discord shows, so the preview reads like the real post, not raw asterisks.
 */
function renderLine(line: string, key: number): ReactNode {
  // Split on the three inline tokens, keeping the delimiters so we can style them.
  const parts = line.split(/(`[^`]+`|\*\*[^*]+\*\*|_[^_]+_)/g).filter(Boolean);
  return (
    <div key={key} className="leading-relaxed">
      {parts.map((part, i) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={i}
              className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8em] text-muted-foreground"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold text-foreground">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("_") && part.endsWith("_")) {
          return (
            <em key={i} className="text-muted-foreground">
              {part.slice(1, -1)}
            </em>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </div>
  );
}

/** A Discord-style embed: colored left accent bar + title + rendered body. */
function EmbedPreview({
  title,
  body,
  accent,
}: {
  title: string;
  body: string;
  accent: string;
}) {
  return (
    <div
      className="rounded-md border border-border bg-card/50 py-3 pl-4 pr-3 text-sm"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <div className="mb-2 font-semibold text-foreground">{title}</div>
      <div className="space-y-1 text-muted-foreground">
        {body.split("\n").map((line, i) => renderLine(line, i))}
      </div>
    </div>
  );
}

/** A muted timeline label above each post (its slot in Moses's day). */
function Slot({ label }: { label: string }) {
  return <div className="mb-1 mt-6 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>;
}

export default async function DiscordPreviewPage() {
  const today = todayEt();
  const [card, morningData] = await Promise.all([previewDailyCard(), getMorningData(today)]);
  const morning = renderMorningDrop(morningData);
  const lesson = renderTeachingDrop(lessonForDate(today));

  return (
    <PageShell>
      <PageHeader
        title="Moses's day — Discord preview"
        description={`Every post Moses would drop today (${card.label}), in order — dry-run, nothing is posted or recorded. Refresh to re-pull.`}
      />

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="rounded bg-muted px-2 py-1">
          {card.premiumCount} card play{card.premiumCount === 1 ? "" : "s"}
        </span>
        <span className="rounded bg-muted px-2 py-1">
          {card.ufcCount} UFC lean{card.ufcCount === 1 ? "" : "s"}
        </span>
        <span className="rounded bg-muted px-2 py-1">
          {morningData.mlbGames} MLB game{morningData.mlbGames === 1 ? "" : "s"}
        </span>
      </div>

      <Slot label="~9:00 AM ET · Morning slate drop" />
      <EmbedPreview title={morning.title} body={morning.description} accent="#06996b" />

      <Slot label="~11:30 AM ET · Moses 101" />
      <EmbedPreview title={lesson.title} body={lesson.description} accent="#06996b" />

      <Slot label="1:00 PM ET · Card of the Day" />
      <EmbedPreview title={`🎯 Archer's Best Plays · ${card.label}`} body={card.premium} accent="#06996b" />
      {card.ufc && card.ufcTitle && (
        <div className="mt-4">
          <EmbedPreview title={card.ufcTitle} body={card.ufc} accent="#d20a0a" />
        </div>
      )}

      <Card className="mt-8">
        <CardHeader className="pb-2 text-sm font-medium text-foreground">What this is</CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          A non-posting dry-run of Moses&apos;s daily Discord posts — the morning drop
          (<code className="font-mono">post-morning</code>), Moses 101
          (<code className="font-mono">post-teaching</code>), and the Card of the Day
          (<code className="font-mono">post-discord</code>). It runs the exact same free-data
          pipelines the real posters use, but posts nothing and writes no grading rows. The daily
          posts stay dormant until <code className="font-mono">DISCORD_MOSES_WEBHOOK_URL</code> is
          set — this page is how you review them first.
        </CardContent>
      </Card>
    </PageShell>
  );
}
