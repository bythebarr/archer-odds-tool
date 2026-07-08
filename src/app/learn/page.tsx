import type { Metadata } from "next";
import { PageShell, PageHeader } from "@/components/PageShell";
import { GLOSSARY, GLOSSARY_CATEGORIES } from "@/lib/glossary";

export const metadata: Metadata = {
  title: "Learn",
  description: "Plain-language guide to every term in ARCHR — EV, de-vig, hit rate, model lean, and more.",
};

/**
 * The glossary — every InfoTip's "Full glossary →" links here, to `#<term-id>`.
 * Content is the single source of truth in `@/lib/glossary`, grouped by
 * category. Written for a first-timer without watering it down for a pro.
 */
export default function LearnPage() {
  return (
    <PageShell width="2xl">
      <PageHeader
        title="How to read ARCHR"
        description="Every term the app uses, in plain language. New to odds tools? Start with Value & EV — that's the whole game."
      />

      {/* The 60-second version — the core loop, up top */}
      <section className="mt-6 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">The 60-second version</h2>
        <ol className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">1. Find value.</span>{" "}
            ARCHR shops every book for the same bet and flags prices that are better than the true odds —
            that&apos;s a <span className="text-foreground">+value</span> play.
          </li>
          <li>
            <span className="font-medium text-foreground">2. Read it two ways.</span>{" "}
            Market value compares the price to the market&apos;s fair number; Model value compares it to
            Archer&apos;s own projection.
          </li>
          <li>
            <span className="font-medium text-foreground">3. Build a slip.</span>{" "}
            Add picks to your bet slip to see combined odds and payout — research only, no real bets.
          </li>
        </ol>
      </section>

      <div className="mt-8 space-y-8">
        {GLOSSARY_CATEGORIES.map((cat) => {
          const entries = GLOSSARY.filter((e) => e.category === cat.key);
          if (entries.length === 0) return null;
          return (
            <section key={cat.key}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {cat.label}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground/70">{cat.blurb}</p>
              <dl className="mt-3 space-y-4">
                {entries.map((entry) => (
                  <div key={entry.id} id={entry.id} className="scroll-mt-24">
                    <dt className="text-sm font-semibold text-foreground">{entry.term}</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {entry.short}
                      {entry.long ? <span className="text-muted-foreground/80"> {entry.long}</span> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
      </div>
    </PageShell>
  );
}
