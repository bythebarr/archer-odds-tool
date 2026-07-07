const BASE_URL = "https://api.citoapi.com/api/v1";

export interface CitoRecord {
  wins: number;
  losses: number;
  draws: number;
  noContest: number;
  text: string;
}

export interface CitoFighterProfile {
  slug: string;
  name: string;
  nickname: string | null;
  division: string | null;
  record: CitoRecord | null;
  recordText: string | null;
  country: string | null;
  status: string | null;
  isActive: boolean | null;
  stance?: string | null;
  heightInches?: string | null;
  reachInches?: string | null;
}

export interface CitoBoutFighter {
  id: string;
  boutId: string;
  fighterSlug: string;
  fighterName: string;
  corner: "red" | "blue" | string;
  outcome: string | null;
  profile: CitoFighterProfile | null;
}

/**
 * Shared shape for both bout-level aggregate stats and per-round stats —
 * Cito returns identical fields for each, with `round` present only on
 * round rows. Numeric splits arrive as "X of Y" strings (landed of
 * attempted) and control time as "MM:SS" — parsed in citoStats.ts, not
 * here, so this client stays a thin, unopinionated wrapper over the raw API.
 */
export interface CitoStatLine {
  fighterSlug: string;
  fighterName: string;
  round?: number;
  knockdowns: number;
  significantStrikes: string;
  totalStrikes: string;
  takedowns: string; // "X of Y" landed-of-attempted, same format as the other split fields below
  submissionAttempts: number;
  reversals: number;
  controlTime: string;
  head: string;
  body: string;
  leg: string;
  distance: string;
  clinch: string;
  ground: string;
}

export interface CitoBout {
  id: string;
  eventSlug: string;
  cardSection: string | null;
  cardSectionOrder: number | null;
  boutOrder: number | null;
  weightClass: string;
  titleBout: boolean;
  status: string;
  isCancelled: boolean;
  winnerFighterSlug: string | null;
  resultRound: number | null;
  resultTime: string | null;
  method: string | null;
  methodDetails: string | null;
  hasStats: boolean;
  fighters: CitoBoutFighter[];
  boutStats: CitoStatLine[] | null;
  roundStats: CitoStatLine[] | null;
}

export interface CitoEvent {
  id: string;
  slug: string;
  title: string;
  status: string;
  startsAt: string | null;
  eventDate: string;
  venue: string | null;
  city: string | null;
  country: string | null;
  hasStats: boolean;
  bouts?: CitoBout[];
}

export interface CitoPaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
}

export interface CitoEventsPage {
  events: CitoEvent[];
  meta: CitoPaginationMeta;
}

async function citoFetch<T>(
  path: string,
  params: Record<string, string | number | boolean>
): Promise<{ data: T; meta?: CitoPaginationMeta }> {
  const apiKey = process.env.CITO_API_KEY;
  if (!apiKey) {
    throw new Error("CITO_API_KEY is not set");
  }

  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, { headers: { "x-api-key": apiKey } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cito API request failed: ${res.status} ${res.statusText} — ${body}`);
  }

  const json = (await res.json()) as { success: boolean; data: T; meta?: CitoPaginationMeta };
  if (!json.success) {
    throw new Error(`Cito API returned success=false for ${path}`);
  }
  return { data: json.data, meta: json.meta };
}

/**
 * Paginated UFC event listing, most-recent-first. `includeBouts=true`
 * embeds each bout's fighters AND full stats (boutStats/roundStats) inline
 * — confirmed live that this covers the entire ~806-event historical
 * dataset in ~81 calls at limit=10/page (the API drops the page limit from
 * 25 to 10 once includeBouts is set, presumably a payload-size guard).
 * `hasStats` filters server-side to events Cito has actually enriched with
 * stats — pass it when only stats-bearing events matter, omit it for a full
 * results-only sweep including not-yet-enriched events.
 */
export async function fetchUfcEvents(
  page: number,
  includeBouts: boolean,
  hasStats?: boolean
): Promise<CitoEventsPage> {
  const params: Record<string, string | number | boolean> = { page, includeBouts };
  if (hasStats !== undefined) params.hasStats = hasStats;

  const { data, meta } = await citoFetch<CitoEvent[]>("/ufc/events/recent", params);
  if (!meta) {
    throw new Error("Cito API response for /ufc/events/recent was missing pagination meta");
  }
  return { events: data, meta };
}

/** Single bout's stats, for the rare case a bout needs re-fetching outside a full events listing pass. */
export async function fetchUfcBoutStats(
  boutId: string
): Promise<{ boutStats: CitoStatLine[]; roundStats: CitoStatLine[] }> {
  const { data } = await citoFetch<{ boutStats: CitoStatLine[]; roundStats: CitoStatLine[] }>(
    `/ufc/bouts/${boutId}/stats`,
    {}
  );
  return data;
}
