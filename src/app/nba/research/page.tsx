import type { Metadata } from "next";
import Link from "next/link";
import { todayEt } from "@/lib/dateEt";
import { getLeagueDays } from "@/lib/queries/lobby";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { refreshOnView } from "@/lib/ops/refreshOnView";
import { getNbaResearchBoard } from "@/lib/shadow/board";
import { CANDIDATE_RULE, VALIDATED_RULES, screenOrder, type SideValue, type ValueRow, type Warning } from "@/lib/shadow/marketValue";
import { V2_VERSION } from "@/lib/shadow/v2";
import { SportCarousel } from "@/components/book/SportCarousel";
import { SportTabs } from "@/components/book/SportTabs";
import { LeagueHeader, leagueTabs } from "@/components/book/LeaguePage";
import { ScrollRow } from "@/components/ScrollRow";
import { EmptyState } from "@/components/EmptyState";

/**
 * The experimental plus-money research screen (docs/alpha-sprint.md): every
 * NBA main-line prop side at its offered price, against ARCHR's raw chance,
 * the experimental shadows' chances and the books' no-vig chance, with the
 * warnings that say how far to trust any of it. Research, never a
 * recommendation; nothing here is a proven edge.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "NBA — plus-money research (experimental)",
  description: "Experimental: NBA main-line props at plus money, ARCHR's experimental chances against the books' no-vig chance, with data-quality warnings. Research only.",
};

const pct = (x: number | null, d = 0) => (x === null ? "—" : `${(x * 100).toFixed(d)}%`);
const signed = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
const chip = (active: boolean) =>
  `shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`;
const startLabel = (iso: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));

const WARNING_TEXT: Record<Warning, string> = {
  "unstable-minutes": "Unstable minutes",
  injury: "Injury tag",
  "lineup-unconfirmed": "Lineup not confirmed",
  "extreme-distance": "Far from the line (model overconfident there)",
  "implausible-disagreement": "Model 12+ pts from the market: more likely a model miss than value",
  "plus-money-calibration": "Plus money: ARCHR has run high here",
  "stale-price": "Stale price",
  "aging-price": "Price over 90 min old",
  "sparse-history": "Thin history",
  "single-book": "Single book: market read is that book's own",
  "no-market": "No two-sided market",
};
const GATING = new Set<Warning>(["unstable-minutes", "injury", "extreme-distance", "implausible-disagreement", "stale-price", "sparse-history", "no-market"]);

const STATUS: Record<SideValue["status"], { label: string; cls: string }> = {
  research: { label: "Research candidate", cls: "bg-muted text-muted-foreground" },
  "forward-testing": { label: "Forward-testing candidate", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  validated: { label: "Independently validated +EV", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
};

function SideCard({ r, s, rank, rankedBy }: { r: ValueRow; s: SideValue; rank: number; rankedBy: "ev" | "research" }) {
  const st = STATUS[s.status];
  const cell = "flex flex-col gap-0.5";
  const label = "text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";
  return (
    <li className="rounded-2xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            #{rank} · {rankedBy === "ev" ? "ranked by EV" : "research priority"} · {r.team} vs {r.opponent} · {startLabel(r.startsAt)}
          </p>
          <p className="truncate text-base font-bold text-foreground">{r.player}</p>
          <p className="text-sm">
            <span className="font-extrabold">
              {s.side === "over" ? "Over" : "Under"} {r.point} {r.statLabel}
            </span>{" "}
            <span className="font-semibold text-foreground">{formatAmerican(s.price)}</span> <span className="text-muted-foreground">{s.book}</span>
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-sm sm:grid-cols-6">
        <div className={cell}>
          <span className={label}>Break-even</span>
          <span className="font-semibold">{pct(s.breakEven, 1)}</span>
        </div>
        <div className={cell}>
          <span className={label}>No-vig{s.singleBook ? " (1 book)" : s.noVigBooks > 1 ? ` (${s.noVigBooks} books)` : ""}</span>
          <span className="font-semibold">{pct(s.noVig, 1)}</span>
        </div>
        <div className={cell}>
          <span className={label}>ARCHR raw</span>
          <span className="font-semibold">{pct(s.rawProb, 1)}</span>
        </div>
        <div className={cell}>
          <span className={label}>Exp. v2 / s2</span>
          <span className="font-semibold">
            {pct(s.v2Prob, 1)} / {pct(s.s2Prob, 1)}
          </span>
        </div>
        <div className={cell}>
          <span className={label}>Est. EV</span>
          <span className={`font-semibold ${s.ev !== null && s.ev > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{signed(s.ev)}</span>
        </div>
        <div className={cell}>
          <span className={label}>Market EV</span>
          <span className="font-semibold">{signed(s.marketEv)}</span>
        </div>
        <div className={cell}>
          <span className={label}>Distance</span>
          <span className="font-semibold">{s.distance === null ? "—" : `${s.distance >= 0 ? "+" : ""}${s.distance.toFixed(2)} SD`}</span>
        </div>
        <div className={cell}>
          <span className={label}>Minutes</span>
          <span className="font-semibold">
            {r.minutes === null ? "—" : r.minutes.toFixed(1)} · {s.minutesReliability}
          </span>
        </div>
        <div className={cell}>
          <span className={label}>Injury / lineup</span>
          <span className="font-semibold">
            {r.injury ?? "none"} · {r.lineup === "unconfirmed" ? "unconfirmed" : r.lineup === "confirmed-starter" ? "starting" : "bench"}
          </span>
        </div>
        <div className={cell}>
          <span className={label}>Price age</span>
          <span className="font-semibold">{s.priceAgeMinutes === null ? "unknown" : `${s.priceAgeMinutes} min`}</span>
        </div>
        <div className={`${cell} col-span-2`}>
          <span className={label}>Evidence</span>
          <span className="text-xs">{s.candidateReason}</span>
        </div>
      </div>
      {s.warnings.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {s.warnings.map((w) => (
            <li key={w} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${GATING.has(w) ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : "bg-muted text-muted-foreground"}`}>
              {WARNING_TEXT[w]}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

const RANGES = [
  { key: "100-175", label: "+100 to +175", lo: 100, hi: 175 },
  { key: "100-300", label: "+100 to +300", lo: 100, hi: 300 },
  { key: "all", label: "All prices", lo: -10000, hi: 10000 },
];

export default async function NbaResearchPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const params = await searchParams;
  await refreshOnView([["sync-injuries", 20], ["espn-props", 30], ["espn-odds", 30]]);
  const days = await getLeagueDays("nba", todayEt());
  const board = await getNbaResearchBoard(days[0] ?? todayEt());
  const range = RANGES.find((r) => r.key === params.range) ?? RANGES[0];
  const sides = board.values.flatMap((r) => [r.over, r.under].filter((s): s is SideValue => s !== null && s.price >= range.lo && s.price <= range.hi).map((s) => ({ r, s })));
  const ordered = screenOrder(sides);
  const candidateIds = new Set(board.candidates);
  const candidates = board.candidates.map((id) => {
    const side = id.endsWith("|over") ? "over" : "under";
    const r = board.values.find((v) => `${v.id}|${side}` === id)!;
    return { r, s: (side === "over" ? r.over : r.under)! };
  });
  const validated = VALIDATED_RULES.includes(CANDIDATE_RULE.id);
  const singleBookOnly = board.books.length <= 1;

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl px-4 pb-24 pt-5 font-sans">
      <SportCarousel active="nba" />
      <LeagueHeader sport="nba" />
      <div className="mt-3">
        <SportTabs tabs={leagueTabs("nba", "research")} />
      </div>
      <h2 className="mt-5 font-display text-2xl font-extrabold uppercase italic leading-none tracking-tight text-foreground">Plus-money research</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Experimental. Every main-line prop side at its offered price, against ARCHR&apos;s chances and the books&apos; own. <strong>Nothing here is a
        proven edge.</strong> The experimental models ({V2_VERSION} and the v1 shadow s2) are being tested on games they haven&apos;t seen; no
        plus-money filter has been validated.
      </p>
      {singleBookOnly && (
        <p className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          Only {board.books[0] ?? "one book"} prices these props right now, so every no-vig read is that book&apos;s own pair: market-dependent, not an
          independent consensus.
        </p>
      )}

      <section className="mt-5">
        <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">
          Forward-testing candidates <span className="font-normal normal-case text-muted-foreground">· rule {CANDIDATE_RULE.id}, frozen before results</span>
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          A side priced +{CANDIDATE_RULE.minPrice} to +{CANDIDATE_RULE.maxPrice}, passing every data-quality check (including neither model more
          than 12 points from the market), with at least +
          {Math.round(CANDIDATE_RULE.minEv * 100)}% expected value at that price under <em>both</em> experimental models (the lower counts); one per
          player, at most {CANDIDATE_RULE.perSlate}. Fewer — or none — is a valid answer. These are recorded before tip and judged on results the
          rule never saw. {validated ? "This rule has been validated forward." : "Status: not validated."}
        </p>
        {candidates.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No candidates right now">Nothing on the slate passes the frozen rule. That is an acceptable outcome, not a gap to fill.</EmptyState>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {candidates.map(({ r, s }, i) => (
              <SideCard key={`${r.id}|${s.side}`} r={r} s={s} rank={i + 1} rankedBy="ev" />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">Every side in range</h3>
        <ScrollRow className="-mx-4 mt-2 flex gap-2 px-4 pb-1">
          {RANGES.map((r) => (
            <Link key={r.key} scroll={false} href={r.key === "100-175" ? "/nba/research" : `/nba/research?range=${r.key}`} className={chip(range.key === r.key)}>
              {r.label}
            </Link>
          ))}
        </ScrollRow>
        <p className="mt-2 text-xs text-muted-foreground">
          Sides passing every data-quality check come first, ranked by estimated EV; the rest follow by research priority (fewest warnings, then how
          far the models sit from the market), which is not a profitability ranking. Red warnings fail the quality check.
        </p>
        {ordered.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No props in this range yet">They show once books post tonight&apos;s NBA props.</EmptyState>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {ordered.slice(0, 60).map(({ s, rankedBy }, i) => {
              const r = board.values.find((v) => v.over === s || v.under === s)!;
              return candidateIds.has(`${r.id}|${s.side}`) ? null : <SideCard key={`${r.id}|${s.side}`} r={r} s={s} rank={i + 1} rankedBy={rankedBy} />;
            })}
          </ul>
        )}
      </section>

      <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
        Break-even is the offered price&apos;s implied chance. No-vig is every other book hanging both sides at this line, de-vigged (the offered
        book left out); with one book it is that book&apos;s own pair. Est. EV is the lower of the two experimental models&apos; expected value at the
        offered price; Market EV is what the no-vig read says the price is worth. ARCHR raw is production&apos;s projection alone. Distance is the
        v2 projection&apos;s gap from the line in its own spread. Minutes reliability is v2&apos;s predicted minutes miss (stable under 4.5, unstable 6+).
        Hit rates over recent games are deliberately not used as a positive signal. Read {new Date(board.computedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET;
        books on the slate: {board.books.join(", ") || "none"}. Research only — see docs/alpha-sprint.md.
      </p>
    </div>
  );
}
