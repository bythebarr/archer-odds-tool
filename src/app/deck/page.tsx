import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { collectPlays } from "@/lib/discord/postCard";
import { getSelection, splitBySelection } from "@/lib/card/selection";
import { SPORTS } from "@/lib/engine";
import { todayEt } from "@/lib/dateEt";
import { PageShell, PageHeader } from "@/components/PageShell";
import { pickAction, clearAction, unitsAction, fireAction } from "./actions";
import { postedAt } from "@/lib/discord/postMarker";
import { cardDropTime } from "@/lib/discord/schedule";

/**
 * The command deck — where the owner turns the engine's slate into the day's
 * card. This is the daily operation: the app has already found and priced every
 * +EV play, so his job is reduced to ticking the ones he'd actually stake.
 *
 * Ticked `card` → #todays-card with units, and into the tracked record.
 * Ticked `free` → #free-play (exactly one), on its own separate record.
 * Untouched    → #ev-slate, no units, never recorded.
 *
 * Gated by CRON_SECRET in `?token=` (same trust level as /api/admin/*), and 404s
 * without it so the page never reveals it exists. Built as plain forms and
 * server actions — no client JS — so it works on a phone on bad hotel wifi,
 * which is where he'll actually be using it.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Deck",
  robots: { index: false, follow: false },
};

const SPORT_LABEL = new Map(SPORTS.map((s) => [s.key, s.meta.label]));
const SPORT_ACCENT = new Map(SPORTS.map((s) => [s.key, s.meta.accent]));

function pct(ev: number | null): string {
  if (ev === null) return "—";
  return `${ev >= 0 ? "+" : ""}${(ev * 100).toFixed(1)}%`;
}

function american(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

function startLabel(startUtc: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(startUtc);
}

/** Green for a positive edge, muted for negative/absent — scannable at a glance. */
function evClass(ev: number | null): string {
  if (ev === null) return "text-muted-foreground";
  return ev > 0 ? "text-[#06996b]" : "text-muted-foreground";
}

export default async function DeckPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; date?: string }>;
}) {
  const { token, date } = await searchParams;
  const expected = process.env.CRON_SECRET;
  if (!expected || !token || token !== expected) notFound();

  const dateEt = date ?? todayEt();
  const [plays, selection, firedAt] = await Promise.all([
    collectPlays(dateEt),
    getSelection(dateEt),
    postedAt("post-card", dateEt),
  ]);
  const split = splitBySelection(plays, selection);
  const dueAt = cardDropTime(plays);

  // Engine order groups by sport already; keep it, so the deck reads like the card.
  const totalEv = plays.length;

  return (
    <PageShell width="2xl">
      <PageHeader
        title="Command deck"
        description={
          <>
            {dateEt} · <strong className="text-foreground">{totalEv}</strong> +EV play
            {totalEv === 1 ? "" : "s"} found · ticked{" "}
            <strong className="text-foreground">{split.card.length}</strong> for the card
            {split.free ? " · free play set" : " · no free play yet"}
          </>
        }
      />

      {/* What happens when the poster fires — the consequence of the ticks below. */}
      <div className="mt-4 rounded-lg border border-border bg-card/50 p-3 text-xs text-muted-foreground">
        <div>
          👑 <strong className="text-foreground">{split.card.length}</strong> → #👑-todays-card ·{" "}
          <strong className="text-foreground">
            {split.card.reduce((s, p) => s + p.suggestedUnits, 0).toFixed(2).replace(/\.?0+$/, "")}u
          </strong>{" "}
          total, tracked on the premium record.
        </div>
        <div className="mt-1">
          🎯 <strong className="text-foreground">{split.free ? 1 : 0}</strong> → #free-play,
          tracked on its own separate record.
        </div>
        <div className="mt-1">
          📊 <strong className="text-foreground">{split.slate.length}</strong> → #ev-slate, no
          units, never recorded.
        </div>
        {split.missing.length > 0 && (
          <div className="mt-2 text-amber-600 dark:text-amber-500">
            ⚠️ {split.missing.length} earlier pick{split.missing.length === 1 ? " is" : "s are"} no
            longer live (line pulled or event scratched) and won&apos;t post.
          </div>
        )}
      </div>

      {/* Fire control. Deliberately below the summary, so the last thing read
          before posting is what's about to go out. */}
      <div className="mt-4 rounded-lg border border-border bg-card/50 p-3">
        {firedAt ? (
          <div className="text-xs text-muted-foreground">
            ✅ Today&apos;s card posted at{" "}
            <strong className="text-foreground">
              {new Intl.DateTimeFormat("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZone: "America/New_York",
              }).format(firedAt)}{" "}
              ET
            </strong>
            . The scheduled post is now skipped for today.
            <details className="mt-2">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Post again anyway
              </summary>
              <p className="mt-1.5 text-muted-foreground">
                This posts a SECOND card to the room. Only useful if the first one went
                out wrong.
              </p>
              <FireButton token={token} dateEt={dateEt} label="Post again" />
            </details>
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">
              Scheduled to post{" "}
              <strong className="text-foreground">
                {dueAt
                  ? `${new Intl.DateTimeFormat("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: "America/New_York",
                    }).format(dueAt)} ET`
                  : "— nothing on the board"}
              </strong>
              {" · "}or send it now:
            </div>
            <FireButton token={token} dateEt={dateEt} label={`🚀 Post to Discord now`} />
            <p className="mt-1.5 text-[0.7rem] text-muted-foreground">
              Posts your {split.card.length} pick{split.card.length === 1 ? "" : "s"} to
              #👑-todays-card{split.free ? ", the free play to #🎁-free-play" : ""}, and{" "}
              {split.slate.length} to #📈-the-firehose. This is live — members see it.
            </p>
          </>
        )}
      </div>

      {plays.length === 0 ? (
        <div className="mt-6 rounded-lg border border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
          No +EV plays on the board for {dateEt}. Nothing to pick — no card is a card.
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {plays.map((p) => {
            const pick = selection.byKey.get(p.playKey) ?? null;
            const current = pick?.stream ?? null;
            const staked = pick?.units ?? p.suggestedUnits;
            const accent = SPORT_ACCENT.get(p.sportKey) ?? "#06996b";
            return (
              <li
                key={p.playKey}
                className="rounded-lg border border-border bg-card/50 p-3"
                style={current ? { borderLeft: `3px solid ${accent}` } : undefined}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span
                    className="rounded px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-white"
                    style={{ backgroundColor: accent }}
                  >
                    {SPORT_LABEL.get(p.sportKey) ?? p.sportKey}
                  </span>
                  <span className="font-semibold text-foreground">{p.selection.label}</span>
                  <span className="text-sm text-muted-foreground">
                    {american(p.bestPrice)} · {p.bestBookName}
                  </span>
                </div>

                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span className={evClass(p.modelEv)}>model {pct(p.modelEv)}</span>
                  <span className={evClass(p.marketEv)}>market {pct(p.marketEv)}</span>
                  <span className="text-muted-foreground">{p.suggestedUnits}u suggested</span>
                  {pick?.units != null && (
                    <span className="font-semibold text-[#06996b]">yours: {staked}u</span>
                  )}
                  <span className="text-muted-foreground">{startLabel(p.startUtc)} ET</span>
                </div>

                {/* Three plain forms — no client JS, so this works anywhere. */}
                <div className="mt-2.5 flex gap-2">
                  <PickButton
                    token={token}
                    dateEt={dateEt}
                    playKey={p.playKey}
                    stream="card"
                    label="👑 Card"
                    active={current === "card"}
                  />
                  <PickButton
                    token={token}
                    dateEt={dateEt}
                    playKey={p.playKey}
                    stream="free"
                    label="🎯 Free"
                    active={current === "free"}
                  />
                  {current && (
                    <PickButton
                      token={token}
                      dateEt={dateEt}
                      playKey={p.playKey}
                      stream=""
                      label="Clear"
                      active={false}
                    />
                  )}
                </div>

                {/* Stake sizing appears only once a play is picked — units on an
                    unpicked play would be a stake on nothing. */}
                {current && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
                    <span className="mr-1 text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                      Units
                    </span>
                    {[0.5, 1, 1.5, 2, 3].map((u) => (
                      <UnitButton
                        key={u}
                        token={token}
                        dateEt={dateEt}
                        playKey={p.playKey}
                        units={String(u)}
                        label={`${u}u`}
                        active={pick?.units === u}
                      />
                    ))}
                    <form action={unitsAction} className="flex items-center gap-1">
                      <input type="hidden" name="token" value={token} />
                      <input type="hidden" name="dateEt" value={dateEt} />
                      <input type="hidden" name="playKey" value={p.playKey} />
                      <input
                        type="number"
                        name="units"
                        step="0.25"
                        min="0"
                        max="25"
                        inputMode="decimal"
                        placeholder="custom"
                        className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                      />
                      <button
                        type="submit"
                        className="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        Set
                      </button>
                    </form>
                    {pick?.units != null && (
                      <UnitButton
                        token={token}
                        dateEt={dateEt}
                        playKey={p.playKey}
                        units=""
                        label="↺ suggested"
                        active={false}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {selection.byKey.size > 0 && (
        <form action={clearAction} className="mt-6">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="dateEt" value={dateEt} />
          <button
            type="submit"
            className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Clear all picks for {dateEt}
          </button>
        </form>
      )}
    </PageShell>
  );
}

function FireButton({ token, dateEt, label }: { token: string; dateEt: string; label: string }) {
  return (
    <form action={fireAction} className="mt-2">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="dateEt" value={dateEt} />
      <button
        type="submit"
        className="rounded-md bg-[#06996b] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
      >
        {label}
      </button>
    </form>
  );
}

function UnitButton({
  token,
  dateEt,
  playKey,
  units,
  label,
  active,
}: {
  token: string;
  dateEt: string;
  playKey: string;
  units: string;
  label: string;
  active: boolean;
}) {
  return (
    <form action={unitsAction}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="dateEt" value={dateEt} />
      <input type="hidden" name="playKey" value={playKey} />
      <input type="hidden" name="units" value={units} />
      <button
        type="submit"
        className={
          "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors " +
          (active
            ? "border-[#06996b] bg-[#06996b] text-white"
            : "border-border text-muted-foreground hover:text-foreground")
        }
      >
        {label}
      </button>
    </form>
  );
}

function PickButton({
  token,
  dateEt,
  playKey,
  stream,
  label,
  active,
}: {
  token: string;
  dateEt: string;
  playKey: string;
  stream: string;
  label: string;
  active: boolean;
}) {
  return (
    <form action={pickAction}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="dateEt" value={dateEt} />
      <input type="hidden" name="playKey" value={playKey} />
      <input type="hidden" name="stream" value={stream} />
      <button
        type="submit"
        className={
          "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors " +
          (active
            ? "border-[#06996b] bg-[#06996b] text-white"
            : "border-border text-muted-foreground hover:text-foreground")
        }
      >
        {label}
      </button>
    </form>
  );
}
