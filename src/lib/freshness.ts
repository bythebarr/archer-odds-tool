import { prisma } from "@/lib/prisma";

// User-facing data freshness. Every board that can look "empty" needs to answer
// the paying user's real question: is this broken, or just not updated yet? We
// answer it honestly from PollLog (the same lastPolledAt each cron writes) plus
// the actual cron cadence, so an empty midnight dashboard reads "odds post
// around 12:35pm ET" instead of dead air. Cadence strings are the real
// vercel.json schedules converted to ET (approximate — DST shifts them an hour,
// hence "around").
export type FeedKey = "mlbOdds" | "props" | "tennisOdds" | "soccerOdds" | "f1";

interface FeedDef {
  /** PollLog.jobName that best represents this feed's last refresh. */
  jobName: string;
  /** Human label, e.g. "MLB odds". */
  label: string;
  /** When it refreshes, in plain ET copy. */
  cadence: string;
}

const FEEDS: Record<FeedKey, FeedDef> = {
  mlbOdds: { jobName: "poll-odds", label: "MLB odds", cadence: "around 12:35pm & 6:30pm ET" },
  props: { jobName: "sync-player-game-logs", label: "prop stats", cadence: "overnight, around 5:30am ET" },
  tennisOdds: { jobName: "poll-odds-tennis", label: "tennis odds", cadence: "each morning, around 5am ET" },
  soccerOdds: { jobName: "poll-odds-soccer", label: "soccer odds", cadence: "every few hours" },
  f1: { jobName: "backfill-f1", label: "F1 results", cadence: "within minutes of each race" },
};

export interface FeedFreshness {
  key: FeedKey;
  label: string;
  cadence: string;
  lastUpdated: Date | null;
  /** Coarse "2h ago" style label, or null when never updated. */
  ageLabel: string | null;
  /** True when the feed reported an error on its last run. */
  errored: boolean;
}

/** Coarse relative age — deliberately low-precision (this is reassurance, not a clock). */
export function formatAge(from: Date, now: Date = new Date()): string {
  const ms = now.getTime() - from.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 2) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(from);
}

export async function getFeedFreshness(key: FeedKey, now: Date = new Date()): Promise<FeedFreshness> {
  const def = FEEDS[key];
  const log = await prisma.pollLog.findUnique({ where: { jobName: def.jobName } });
  const lastUpdated = log?.lastPolledAt ?? null;
  return {
    key,
    label: def.label,
    cadence: def.cadence,
    lastUpdated,
    ageLabel: lastUpdated ? formatAge(lastUpdated, now) : null,
    errored: (log?.lastStatus ?? "").toLowerCase().startsWith("error"),
  };
}
