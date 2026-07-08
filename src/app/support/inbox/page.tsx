import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageShell, PageHeader } from "@/components/PageShell";
import { FEEDBACK_CATEGORIES } from "@/lib/feedback";

// Private feedback inbox. Gated by a shared token in SUPPORT_INBOX_TOKEN — no
// auth system needed to launch. Without the env set, or with a wrong/absent
// token, it 404s (never reveals that an inbox exists). noindex for good measure.
// This is the stopgap read surface until a real admin/notification path exists.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Inbox",
  robots: { index: false, follow: false },
};

const CATEGORY_LABEL = Object.fromEntries(FEEDBACK_CATEGORIES.map((c) => [c.value, c.label]));

function when(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(d);
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const expected = process.env.SUPPORT_INBOX_TOKEN;

  // No configured token, or a mismatch → behave as if the page doesn't exist.
  if (!expected || !token || token !== expected) {
    notFound();
  }

  const [items, openCount] = await Promise.all([
    prisma.feedback.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.feedback.count({ where: { resolved: false } }),
  ]);

  return (
    <PageShell width="2xl">
      <PageHeader
        title="Feedback inbox"
        description={`${items.length} shown · ${openCount} unresolved`}
      />

      {items.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">No feedback yet.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {items.map((f) => (
            <div key={f.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-accent-foreground">
                    {CATEGORY_LABEL[f.category] ?? f.category}
                  </span>
                  {f.context ? <span className="font-mono">{f.context}</span> : null}
                  {f.resolved ? <span className="text-emerald-600 dark:text-emerald-400">resolved</span> : null}
                </span>
                <span>{when(f.createdAt)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{f.message}</p>
              {f.email ? (
                <a href={`mailto:${f.email}`} className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
                  {f.email}
                </a>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}
