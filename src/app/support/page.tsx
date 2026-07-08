import type { Metadata } from "next";
import { PageShell, PageHeader } from "@/components/PageShell";
import { FeedbackForm } from "@/components/FeedbackForm";

export const metadata: Metadata = {
  title: "Support & feedback",
  description:
    "Get help, report a problem, or send feedback — plus straight answers on when odds and props update and why a board might look empty.",
};

// Static content + a client form; no per-request data, so it can prerender.
const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "Why is my board empty?",
    a: (
      <>
        Almost always because the day&apos;s odds haven&apos;t posted yet — not because anything&apos;s broken. Each
        board shows when it last updated and roughly when the next refresh lands. If it&apos;s well past the update
        window and still empty, that&apos;s worth reporting below.
      </>
    ),
  },
  {
    q: "When does the data update?",
    a: (
      <ul className="mt-1 flex flex-col gap-1">
        <li>
          <span className="font-medium text-foreground">MLB odds</span> — around 12:35pm &amp; 6:30pm ET.
        </li>
        <li>
          <span className="font-medium text-foreground">Player prop stats</span> — overnight, around 5:30am ET.
        </li>
        <li>
          <span className="font-medium text-foreground">Tennis odds</span> — each morning, around 5am ET.
        </li>
        <li>
          <span className="font-medium text-foreground">Soccer odds</span> — every few hours through the day.
        </li>
        <li>
          <span className="font-medium text-foreground">F1 results &amp; standings</span> — within minutes of each
          race finishing.
        </li>
      </ul>
    ),
  },
  {
    q: "Times are approximate — right?",
    a: (
      <>
        Yes. Odds are pulled on a schedule and can land a little early or late depending on when books post their
        lines. &quot;Around 12:35pm ET&quot; means the refresh runs then; if a game&apos;s line isn&apos;t up yet at the
        book, it fills in on the next pass.
      </>
    ),
  },
  {
    q: "How do I report a problem or ask for help?",
    a: (
      <>
        Use the form below — it reaches us directly. Include what you expected, what you saw, and roughly when.
        Leave an email if you&apos;d like a reply.
      </>
    ),
  },
  {
    q: "Is this betting advice?",
    a: (
      <>
        No. ARCHR is a research and discovery tool — odds line-shopping, model leans, hit-rates, and EV for your own
        analysis. It doesn&apos;t place bets and nothing here is a guarantee. If gambling is a problem for you, call or
        text 1-800-522-4700.
      </>
    ),
  },
];

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;

  return (
    <PageShell width="2xl">
      <PageHeader
        title="Support & feedback"
        description="Straight answers on updates and empty boards — and a direct line to us for anything else."
      />

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Common questions</h2>
        <div className="mt-3 flex flex-col divide-y divide-border/60 rounded-2xl border border-border bg-card">
          {FAQ.map((item) => (
            <div key={item.q} className="px-4 py-3.5">
              <h3 className="text-sm font-semibold text-foreground">{item.q}</h3>
              <div className="mt-1 text-sm text-muted-foreground">{item.a}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Report a problem or send feedback
        </h2>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">
          Every message reaches us. We read all of it — it&apos;s how ARCHR gets better.
        </p>
        <FeedbackForm initialContext={from} />
      </section>
    </PageShell>
  );
}
