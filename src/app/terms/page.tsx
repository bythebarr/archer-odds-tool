import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageShell } from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Terms of Service — ARCHR Edge",
  description: "The terms governing use of ARCHR Edge and the ARCHR Discord community.",
};

const UPDATED = "July 11, 2026";

function Section({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-base font-semibold text-foreground">
        {n}. {title}
      </h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <PageShell>
      <h1 className="text-xl font-semibold text-foreground">Terms of Service</h1>
      <p className="mt-1 text-xs text-muted-foreground">Last updated: {UPDATED}</p>

      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of ARCHR Edge, the
        ARCHR Discord community, and any related content, tools, or picks we provide (together, the
        &ldquo;Service&rdquo;), operated by ARCHR (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or
        &ldquo;our&rdquo;). By joining the community, subscribing, or otherwise using the Service, you
        agree to these Terms. If you do not agree, do not use the Service.
      </p>

      <Section n="1" title="Eligibility (21+)">
        <p>
          The Service is intended for adults of legal gambling age in their jurisdiction — at least 21
          years old (or the applicable legal age where you live). By using the Service you represent
          that you meet this requirement and that sports wagering is legal where you are. You are
          responsible for complying with all laws that apply to you.
        </p>
      </Section>

      <Section n="2" title="What ARCHR Edge is — and is not">
        <p>
          ARCHR Edge provides <strong>research and entertainment content</strong> — model
          projections, statistics, and opinion-based &ldquo;picks&rdquo; and leans. It is{" "}
          <strong>not betting advice, not financial advice, and not a guarantee of any outcome.</strong>{" "}
          We are not a sportsbook, do not accept or place wagers, and do not handle any betting funds.
          Any bet you place is your own independent decision, made at your own risk.
        </p>
      </Section>

      <Section n="3" title="No guarantees">
        <p>
          Sports outcomes are inherently uncertain. Past performance, records, or unit results shown in
          the Service do not guarantee future results. We make no warranty that any pick, model, or
          piece of content will be accurate, profitable, or suitable for you. You could lose money. Only
          ever stake what you can afford to lose.
        </p>
      </Section>

      <Section n="4" title="Membership and payments">
        <p>
          Some content is offered through a paid membership. Payments, billing, renewals, and
          cancellations are handled by our third-party provider (e.g. Whop) under their terms. Unless
          required by law or stated otherwise at purchase, memberships renew automatically until
          cancelled, and fees already paid are non-refundable. You can cancel at any time through the
          provider; access continues until the end of the paid period. We may change pricing or features
          on a going-forward basis.
        </p>
      </Section>

      <Section n="5" title="Acceptable use">
        <p>
          You agree not to: (a) redistribute, resell, scrape, or republish our picks or content outside
          the community; (b) share your access with non-members; (c) harass other members or violate
          Discord&rsquo;s Terms of Service and Community Guidelines; or (d) use the Service for any
          unlawful purpose. We may suspend or remove access, without refund, for conduct that breaches
          these Terms.
        </p>
      </Section>

      <Section n="6" title="Intellectual property">
        <p>
          All content we provide — models, projections, write-ups, branding, and the ARCHR and ARCHR
          Edge names — is owned by us or our licensors and is provided for your personal,
          non-commercial use only. You receive no ownership rights by using the Service.
        </p>
      </Section>

      <Section n="7" title="Responsible gaming">
        <p>
          Please bet responsibly. If gambling stops being fun or starts causing harm, help is available
          24/7 at <strong>1-800-522-4700</strong> (or 1-800-GAMBLER). You can also set deposit and time
          limits with your sportsbook, or self-exclude. Never chase losses, and never bet money you need.
        </p>
      </Section>

      <Section n="8" title="Disclaimers and limitation of liability">
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties
          of any kind, express or implied. To the fullest extent permitted by law, we are not liable for
          any indirect, incidental, or consequential damages, or for any betting losses, arising from
          your use of the Service. Our total liability for any claim relating to the Service will not
          exceed the amount you paid us in the three months before the claim.
        </p>
      </Section>

      <Section n="9" title="Changes and termination">
        <p>
          We may update these Terms from time to time; the &ldquo;Last updated&rdquo; date above will
          change and continued use means you accept the update. We may modify, suspend, or discontinue
          any part of the Service, and may terminate access for violations of these Terms.
        </p>
      </Section>

      <Section n="10" title="Contact">
        <p>
          Questions about these Terms? Reach us at <strong>support@archrhub.com</strong> or in the{" "}
          <code className="font-mono">#support</code> channel of the ARCHR Discord.
        </p>
      </Section>

      <p className="mt-8 text-xs text-muted-foreground">
        Research/entertainment only · not betting advice · 21+ · gamble responsibly 1-800-522-4700
      </p>
    </PageShell>
  );
}
