import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageShell } from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Privacy Policy — ARCHR Edge",
  description: "How ARCHR Edge collects, uses, and protects your information.",
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

export default function PrivacyPage() {
  return (
    <PageShell>
      <h1 className="text-xl font-semibold text-foreground">Privacy Policy</h1>
      <p className="mt-1 text-xs text-muted-foreground">Last updated: {UPDATED}</p>

      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        This Privacy Policy explains how ARCHR (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;)
        handles information in connection with ARCHR Edge and the ARCHR Discord community (the
        &ldquo;Service&rdquo;). We keep data collection to the minimum needed to run the Service.
      </p>

      <Section n="1" title="Information we collect">
        <p>
          <strong>Discord account information.</strong> When you join our community, we (and our bot)
          receive the basic account details Discord shares — your user ID, username, avatar, and your
          roles and activity within our server.
        </p>
        <p>
          <strong>Membership &amp; payment information.</strong> Paid memberships are processed by our
          third-party provider (e.g. Whop and its payment processors). They collect and handle your
          payment details; <strong>we do not receive or store your full card or bank information.</strong>{" "}
          We may receive confirmation of your subscription status so we can grant or remove access.
        </p>
        <p>
          <strong>Communications.</strong> Messages you send us for support, and content you post in the
          community, are visible per the channel&rsquo;s settings.
        </p>
      </Section>

      <Section n="2" title="How we use information">
        <p>
          We use information to operate and secure the Service, grant and manage membership access,
          deliver picks and content, respond to support requests, and comply with legal obligations. We
          do not use your information to make automated decisions that produce legal effects about you.
        </p>
      </Section>

      <Section n="3" title="How we share information">
        <p>
          We <strong>do not sell your personal information.</strong> We share it only with service
          providers who help us run the Service — for example Discord (community platform), Whop
          (membership &amp; billing), and our hosting/infrastructure providers — and only as needed for
          them to perform those services, or where required by law.
        </p>
      </Section>

      <Section n="4" title="Cookies and analytics">
        <p>
          Our website may use strictly necessary cookies to function, and limited, privacy-respecting
          analytics to understand aggregate usage. We do not use advertising trackers.
        </p>
      </Section>

      <Section n="5" title="Data retention">
        <p>
          We keep information only as long as needed to provide the Service, meet legal or accounting
          requirements, and resolve disputes. When you leave the community, we remove access-related data
          that is no longer needed.
        </p>
      </Section>

      <Section n="6" title="Your choices and rights">
        <p>
          You can leave the community at any time, and cancel membership through the payment provider.
          Depending on where you live, you may have rights to access, correct, or delete personal
          information we hold. To make a request, contact us using the details below and we&rsquo;ll
          respond as required by applicable law.
        </p>
      </Section>

      <Section n="7" title="Age restriction">
        <p>
          The Service is for adults of legal gambling age (21+ or the applicable age where you live). It
          is not directed to children, and we do not knowingly collect information from anyone under
          that age. If you believe a minor has provided us information, contact us and we&rsquo;ll delete
          it.
        </p>
      </Section>

      <Section n="8" title="Changes to this policy">
        <p>
          We may update this Policy from time to time. The &ldquo;Last updated&rdquo; date above will
          change, and material changes will be communicated in the community.
        </p>
      </Section>

      <Section n="9" title="Contact">
        <p>
          Privacy questions or requests? Reach us at <strong>support@archrhub.com</strong> or in the{" "}
          <code className="font-mono">#support</code> channel of the ARCHR Discord.
        </p>
      </Section>

      <p className="mt-8 text-xs text-muted-foreground">
        Research/entertainment only · not betting advice · 21+ · gamble responsibly 1-800-522-4700
      </p>
    </PageShell>
  );
}
