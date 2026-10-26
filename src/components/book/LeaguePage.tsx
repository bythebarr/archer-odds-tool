import { getLeagueDays, getLeagueEvents } from "@/lib/queries/lobby";
import { todayEt, isValidEtDate } from "@/lib/dateEt";
import { sportMetaByKey } from "@/lib/engine/sportsMeta";
import type { TeamLeagueSport } from "@/lib/teamLeague/league";
import { getFeedFreshness, type FeedKey } from "@/lib/freshness";
import { EmptyState } from "@/components/EmptyState";
import { FreshnessStamp } from "@/components/FreshnessStamp";
import { SportCarousel } from "./SportCarousel";
import { SportTabs } from "./SportTabs";
import { DateStrip } from "./DateStrip";
import { EventListHeader, EventRow } from "./EventRow";
import { Glyph } from "@/components/brand/Glyph";

/** The tabs every league page and its props page share. Props only where a league has a props product. */
export function leagueTabs(sport: TeamLeagueSport, active: "lines" | "props") {
  const tabs = [{ label: "Game Lines", href: `/${sport}`, active: active === "lines" }];
  if (sport === "nba") tabs.push({ label: "Player Props", href: "/nba/props", active: active === "props" });
  if (sport === "nfl") {
    tabs.push({ label: "Player Props", href: "/nfl/props", active: active === "props" });
    tabs.push({ label: "Research", href: "/nfl/research", active: false });
  }
  return tabs;
}

/** Sport icon + name, the header every league surface opens with. */
export function LeagueHeader({ sport }: { sport: TeamLeagueSport | "ufc" }) {
  const meta = sportMetaByKey[sport];
  return (
    <div className="mt-5 flex items-center gap-2.5 text-foreground">
      <Glyph name={sport} className="size-7" />
      <h1 className="font-display text-3xl font-extrabold uppercase italic leading-none tracking-tight">{meta.label}</h1>
    </div>
  );
}

const FEED: Record<TeamLeagueSport, FeedKey> = { nba: "nbaOdds", nfl: "nflOdds" };

/**
 * A league's sportsbook page: the sport switcher, Game Lines / Player Props
 * tabs, a strip of the days that have games, then each game as a row with its
 * best Spread, Total and Moneyline.
 */
export async function LeaguePage({ sport, dateParam }: { sport: TeamLeagueSport; dateParam?: string }) {
  const today = todayEt();
  const [days, freshness] = await Promise.all([getLeagueDays(sport, today), getFeedFreshness(FEED[sport])]);
  const date = dateParam && isValidEtDate(dateParam) ? dateParam : (days[0] ?? today);
  const events = await getLeagueEvents(sport, date);
  const label = sportMetaByKey[sport].label;

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-10 pt-5 font-sans">
      <SportCarousel active={sport} />
      <LeagueHeader sport={sport} />
      <div className="mt-3">
        <SportTabs tabs={leagueTabs(sport, "lines")} />
      </div>
      <div className="mt-4">
        <DateStrip days={days.includes(date) ? days : [date, ...days].sort()} active={date} href={(d) => `/${sport}?date=${d}`} />
      </div>

      {events.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={`No ${label} games on this day`} freshness={freshness} arrow="miss" supportContext={`${sport}-empty`}>
            {days.length > 0
              ? "Pick another day above."
              : `Books post ${label} lines as games approach. Nothing is on the board right now.`}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="mt-5">
            <EventListHeader />
            <div className="flex flex-col gap-2.5">
              {events.map((e) => (
                <EventRow key={e.id} event={e} sport={sport} />
              ))}
            </div>
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            Best price across bettable books at the main line. The dot on each price is the book; tap a price to add it
            to your slip, or a team for every market and book.
          </p>
          <div className="mt-3">
            <FreshnessStamp freshness={freshness} />
          </div>
        </>
      )}
    </div>
  );
}
