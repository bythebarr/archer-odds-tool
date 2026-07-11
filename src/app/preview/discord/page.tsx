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
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/** Scoped ARCHR Edge motion — a glowing wordmark, a live pulse, a sweeping
 *  accent line, and staggered rise-in on each post. Honors reduced-motion. */
const ARCHREDGE_CSS = `
  .archredge-edge { color: #06996b; animation: archredge-glow 3s ease-in-out infinite; }
  .archredge-dot { animation: archredge-pulse 1.6s ease-in-out infinite; }
  .archredge-scan {
    background: linear-gradient(90deg, transparent, #06996b, transparent);
    background-size: 200% 100%;
    animation: archredge-sweep 3.5s linear infinite;
  }
  .archredge-post { animation: archredge-rise 0.5s ease-out both; }
  @keyframes archredge-glow {
    0%, 100% { text-shadow: 0 0 0 rgba(6,153,107,0); }
    50% { text-shadow: 0 0 14px rgba(6,153,107,0.55); }
  }
  @keyframes archredge-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(6,153,107,0.6); }
    50% { box-shadow: 0 0 0 4px rgba(6,153,107,0); }
  }
  @keyframes archredge-sweep {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  @keyframes archredge-rise {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .archredge-edge, .archredge-dot, .archredge-scan, .archredge-post { animation: none !important; }
  }
`;

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

/** One timeline post that rises into view, staggered by `delay`. */
function Post({
  slot,
  title,
  body,
  accent,
  delay,
}: {
  slot: string;
  title: string;
  body: string;
  accent: string;
  delay: number;
}) {
  return (
    <div className="archredge-post" style={{ animationDelay: `${delay}ms` }}>
      <Slot label={slot} />
      <EmbedPreview title={title} body={body} accent={accent} />
    </div>
  );
}

export default async function DiscordPreviewPage() {
  const today = todayEt();
  const [card, morningData] = await Promise.all([previewDailyCard(), getMorningData(today)]);
  const morning = renderMorningDrop(morningData);
  const lesson = renderTeachingDrop(lessonForDate(today));

  return (
    <PageShell>
      <style>{ARCHREDGE_CSS}</style>

      {/* Branded hero */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-card to-background p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-black tracking-tight text-foreground">
              ARCHR <span className="archredge-edge">Edge</span>
            </div>
            <div className="mt-1 text-[0.7rem] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Moses&apos;s daily drop · {card.label}
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
            <span className="archredge-dot h-1.5 w-1.5 rounded-full bg-[#06996b]" />
            Live preview
          </span>
        </div>
        <div className="archredge-scan mt-4 h-px w-full" />
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
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Every post Moses drops today, in order — dry-run, nothing is posted or recorded. Refresh to re-pull.
      </p>

      <Post
        slot="~9:00 AM ET · Morning slate drop"
        title={morning.title}
        body={morning.description}
        accent="#06996b"
        delay={0}
      />
      <Post
        slot="~11:30 AM ET · Moses 101"
        title={lesson.title}
        body={lesson.description}
        accent="#06996b"
        delay={90}
      />
      <Post
        slot="1:00 PM ET · Card of the Day"
        title={`🎯 ARCHR Edge · Best Plays · ${card.label}`}
        body={card.premium}
        accent="#06996b"
        delay={180}
      />
      {card.ufc && card.ufcTitle && (
        <div className="archredge-post mt-4" style={{ animationDelay: "270ms" }}>
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
