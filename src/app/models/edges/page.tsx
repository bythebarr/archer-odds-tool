import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getEdgeReport, EDGE_WINDOWS, type EdgeWindow } from "@/lib/queries/edgeReport";
import { readTokenOk } from "@/lib/tokenAuth";
import type { SegmentStats, Verdict } from "@/lib/tracking/evaluate";
import { MIN_LEANS } from "@/lib/tracking/evaluate";

export const metadata: Metadata = {
  title: "Edge tracker — which of ARCHR's edges hold up",
  description: "Every lean ARCHR makes before a game, graded after it: hit rate, profit, closing-line value and accuracy against the market, by sport, stat, side, edge size and price.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const VERDICT: Record<Verdict, { tone: string; note: string }> = {
  working: { tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", note: "Profit's 95% range is above zero" },
  "beating the close": { tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", note: "The line keeps moving toward these leans" },
  unproven: { tone: "bg-muted text-muted-foreground", note: "No clear sign either way yet" },
  "losing to the close": { tone: "bg-amber-500/15 text-amber-800 dark:text-amber-200", note: "The line keeps moving away from these leans" },
  "not working": { tone: "bg-red-500/15 text-red-700 dark:text-red-300", note: "Profit's 95% range is below zero" },
  "too early": { tone: "bg-muted text-muted-foreground", note: `Fewer than ${MIN_LEANS} graded` },
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const signedPct = (x: number, digits = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(digits)}%`;
const pts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}`;

function Row({ s }: { s: SegmentStats }) {
  const v = VERDICT[s.verdict];
  return (
    <tr className="border-t border-border align-top">
      <td className="py-2 pr-2">
        <p className="font-medium text-foreground">{s.label}</p>
        <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${v.tone}`} title={v.note}>
          {s.verdict}
        </span>
      </td>
      <td className="px-2 py-2 text-right font-mono">{s.n.toLocaleString()}</td>
      <td className="px-2 py-2 text-right font-mono">
        {s.n ? pct(s.hitRate) : "—"}
        <span className="block text-[10px] text-muted-foreground">said {s.n ? pct(s.expected) : "—"}</span>
      </td>
      <td className={`px-2 py-2 text-right font-mono ${s.roi > 0 ? "text-emerald-600 dark:text-emerald-400" : s.roi < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
        {s.n ? signedPct(s.roi) : "—"}
        {s.n >= MIN_LEANS && (
          <span className="block text-[10px] text-muted-foreground">
            {signedPct(s.roiLow, 0)} to {signedPct(s.roiHigh, 0)}
          </span>
        )}
      </td>
      <td className="px-2 py-2 text-right font-mono">
        {s.clv !== null ? pts(s.clv) : "—"}
        {s.beatClose !== null && <span className="block text-[10px] text-muted-foreground">{pct(s.beatClose)} beat</span>}
      </td>
      <td className="py-2 pl-2 text-right font-mono">{s.skill !== null ? (s.skill * 1000).toFixed(1) : "—"}</td>
    </tr>
  );
}

function Table({ title, segments }: { title: string; segments: SegmentStats[] }) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="-mx-4 mt-2 overflow-x-auto px-4">
        <table className="w-full min-w-[34rem] text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1.5 pr-2 text-left font-semibold">Segment</th>
              <th className="px-2 py-1.5 text-right font-semibold">Graded</th>
              <th className="px-2 py-1.5 text-right font-semibold">Hit</th>
              <th className="px-2 py-1.5 text-right font-semibold">ROI</th>
              <th className="px-2 py-1.5 text-right font-semibold">CLV (pts)</th>
              <th className="py-1.5 pl-2 text-right font-semibold" title="Market's Brier minus ARCHR's, ×1000: above 0, ARCHR's chances were closer">
                vs market
              </th>
            </tr>
          </thead>
          <tbody>
            {segments.map((s) => (
              <Row key={s.key} s={s} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * The edge tracker: every lean ARCHR made before a game (lib/tracking), graded
 * after it and cut every way, so the edges that hold up stand apart from the
 * ones that don't.
 *
 * Owner-only, like /deck: gated by CRON_SECRET in `?token=`, and a 404
 * without it, so the page doesn't even show it exists.
 */
export default async function EdgesPage({ searchParams }: { searchParams: Promise<{ window?: string; token?: string }> }) {
  const params = await searchParams;
  if (!params.token || !readTokenOk(params.token)) notFound();
  const token = params.token as string;
  const window: EdgeWindow = params.window && params.window in EDGE_WINDOWS ? (params.window as EdgeWindow) : "90";
  const report = await getEdgeReport(window);
  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl px-4 pb-10 pt-5 font-sans">
      <Link href="/models" className="text-xs font-semibold text-muted-foreground hover:text-foreground">
        ← Model report card
      </Link>
      <h1 className="mt-2 font-display text-3xl font-extrabold uppercase italic leading-none tracking-tight text-foreground">Edge tracker</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Shortly before every NBA and NFL game, ARCHR&apos;s lean on every prop and game line is frozen: its side, its chance, the price and the
        market&apos;s own chance. After the game each is graded, with the closing line beside it. Cut by sport, stat, side, edge size, confidence and
        price, the edges that hold up separate from the ones that don&apos;t.
      </p>
      <div className="mt-3 flex gap-2 text-xs">
        {(Object.keys(EDGE_WINDOWS) as EdgeWindow[]).map((w) => (
          <Link
            key={w}
            href={`/models/edges?window=${w}&token=${encodeURIComponent(token)}`}
            className={`rounded-full px-3 py-1.5 font-semibold ${w === window ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          >
            {w === "season" ? "Season" : `Last ${w} days`}
          </Link>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {report.overall.n.toLocaleString()} graded leans{report.since ? ` since ${new Date(report.since).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""} ·{" "}
        {report.pending.toLocaleString()} waiting on their games
      </p>

      {report.overall.n === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm font-semibold text-foreground">Nothing graded yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Leans are captured a few hours before each game and graded once it&apos;s final. The first results land the morning after the first slate.</p>
        </div>
      ) : (
        <>
          <Table title="Overall" segments={[report.overall]} />
          {report.dimensions.map((d) => (
            <Table key={d.key} title={d.label} segments={d.segments} />
          ))}
        </>
      )}

      <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
        A lean is the side ARCHR favors: each prop at its main line, each game&apos;s moneyline, spread and total. <b>Hit</b> is how often it cashed,
        beside ARCHR&apos;s average chance (they should match). <b>ROI</b> is a flat unit on every lean at the best price when captured (−110 where the
        book had posted its number but not its price), with its 95% range. <b>CLV</b> is how far the market&apos;s no-vig chance moved toward the lean
        from capture to the close, in percentage points, and how often it did: the earliest sign of a real edge, since it reads in far fewer bets
        than profit. <b>vs market</b> compares ARCHR&apos;s chances with the market&apos;s at capture (Brier score, ×1000; above 0, ARCHR was closer).
        Verdicts: <b>working</b> when profit&apos;s 95% range clears zero, <b>not working</b> when it&apos;s all below; with 100+ closing lines,{" "}
        <b>beating</b> or <b>losing to the close</b>. Pushes and voids (didn&apos;t play) don&apos;t count. Research only.
      </p>
    </div>
  );
}
