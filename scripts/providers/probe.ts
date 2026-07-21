/**
 * Feed it API keys, get back what each one is actually good for.
 *
 *   npx tsx --env-file=.env scripts/providers/probe.ts
 *
 * Reads every `*_API_KEY` in the environment, works out which provider each key
 * belongs to (you don't have to know — see FINGERPRINTING below), measures what
 * that provider really serves, and prints a recommended ROLE for it.
 *
 * Why this exists: provider pricing pages describe coverage in terms that don't
 * survive contact with a live slate. ParlayAPI advertises player props and does
 * serve them — from PrizePicks and Bovada, while FanDuel appears on 2 games in
 * 25. Nothing but a live count tells you that. So every number here comes from a
 * real call made just now, and anything that can't be measured is reported as
 * unknown rather than filled in from documentation.
 *
 * FINGERPRINTING: a key is an opaque string, so a var named UNKNOWN_API_KEY_1 is
 * offered to every candidate provider in turn and whoever accepts it wins. Name
 * a var after its provider (THERUNDOWN_API_KEY) and that provider is simply
 * tried first.
 *
 * Adding a provider = one entry in CANDIDATES. A provider whose response shape
 * isn't mapped yet still reports auth, quota, and the endpoints that answered,
 * which is enough to decide whether it's worth mapping properly.
 */

/** Books a member can actually bet at — the only ones that count for line shopping. */
const MAINSTREAM = new Set([
  "draftkings", "fanduel", "betmgm", "caesars", "espnbet", "fanatics",
  "betrivers", "bet365", "hardrock", "pointsbet", "wynnbet",
]);
/** Priced from, never recommended: sharp but not available to US retail. */
const SHARP = new Set(["pinnacle", "circa", "betonlineag"]);
/** Pick'em apps. Real products, but they are NOT sportsbooks and must not pad a book count. */
const DFS = new Set(["prizepicks", "underdog", "sleeper", "maverick_games", "betr", "pick6", "dabble", "boom"]);
/** Offshore/unregulated — not somewhere to send paying members. */
const OFFSHORE = new Set(["bovada", "mybookieag", "betanysports", "lowvig", "betus"]);

function classify(book: string): "mainstream" | "sharp" | "dfs" | "offshore" | "other" {
  const k = book.toLowerCase();
  if (MAINSTREAM.has(k)) return "mainstream";
  if (SHARP.has(k)) return "sharp";
  if (DFS.has(k)) return "dfs";
  if (OFFSHORE.has(k)) return "offshore";
  return "other";
}

interface Probe {
  id: string;
  label: string;
  /** Build a request for a path. Providers differ on header vs query auth. */
  request: (key: string, path: string, params?: Record<string, string>) => Request;
  /** Cheap endpoint that proves the provider is reachable. */
  ping: string;
  /**
   * An endpoint that actually CHECKS the key, when `ping` doesn't.
   *
   * Required because some providers serve their catalogue unauthenticated:
   * ParlayAPI returns 200 and 83 sports for any string at all, so without this
   * every key in the file fingerprints as ParlayAPI. Identification has to rest
   * on a call the provider would refuse a stranger.
   */
  verify?: { path: string; params?: Record<string, string> };
  /**
   * True if this provider speaks the "Odds API shape" — a flat event array with
   * nested bookmakers → markets → outcomes. Parlay cloned TOA's schema, so one
   * profiler covers both, and any provider that also cloned it comes free.
   */
  oddsApiShaped?: boolean;
  /** Odds-API-shaped providers: the sport key and markets to profile with. */
  sportKey?: string;
  /** Endpoints worth trying to see whether results/scores and props exist. */
  extras?: Record<string, { path: string; params?: Record<string, string> }>;
}

const q = (base: string, path: string, params: Record<string, string> = {}) => {
  const u = new URL(base + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u;
};

const CANDIDATES: Probe[] = [
  {
    id: "parlay",
    label: "ParlayAPI",
    request: (key, path, params) => new Request(q("https://parlay-api.com/v1", path, { ...params, apiKey: key })),
    ping: "/sports",
    verify: { path: "/sports/baseball_mlb/scores" },
    oddsApiShaped: true,
    sportKey: "baseball_mlb",
    extras: {
      props: { path: "/sports/baseball_mlb/props" },
      scores: { path: "/sports/baseball_mlb/scores" },
      altLines: { path: "/sports/baseball_mlb/odds", params: { markets: "alternate_spreads,alternate_totals" } },
      tennisScores: { path: "/sports/tennis_atp/scores" },
    },
  },
  {
    id: "theoddsapi",
    label: "The Odds API",
    request: (key, path, params) => new Request(q("https://api.the-odds-api.com/v4", path, { ...params, apiKey: key })),
    ping: "/sports",
    oddsApiShaped: true,
    sportKey: "baseball_mlb",
    extras: {
      scores: { path: "/sports/baseball_mlb/scores", params: { daysFrom: "1" } },
      altLines: {
        path: "/sports/baseball_mlb/odds",
        params: { markets: "alternate_spreads,alternate_totals", regions: "us" },
      },
    },
  },
  {
    id: "therundown",
    label: "TheRundown",
    request: (key, path, params) =>
      new Request(q("https://therundown.io/api/v2", path, params), { headers: { "x-api-key": key } }),
    ping: "/sports",
  },
  {
    id: "opticodds",
    label: "OpticOdds",
    request: (key, path, params) =>
      new Request(q("https://api.opticodds.com/api/v3", path, params), { headers: { "x-api-key": key } }),
    ping: "/sports",
  },
  {
    id: "sportsgameodds",
    label: "SportsGameOdds",
    request: (key, path, params) =>
      new Request(q("https://api.sportsgameodds.com/v2", path, params), { headers: { "X-Api-Key": key } }),
    ping: "/sports",
  },
  {
    id: "oddsblaze",
    label: "OddsBlaze",
    request: (key, path, params) => new Request(q("https://data.oddsblaze.com/v1", path, { ...params, key })),
    ping: "/sportsbooks",
  },
  {
    id: "cito",
    label: "Cito (UFC)",
    request: (key, path, params) =>
      new Request(q("https://api.citoapi.com/api/v1", path, params), { headers: { Authorization: `Bearer ${key}` } }),
    ping: "/events",
  },
];

/** Quota/rate-limit facts providers publish in headers — the real budget signal. */
function quotaFrom(res: Response): string {
  const interesting = [...res.headers].filter(([k]) => /remain|used|limit|credit|quota|cost/i.test(k));
  return interesting.length ? interesting.map(([k, v]) => `${k}=${v}`).join("  ") : "(none published)";
}

async function tryJson(req: Request): Promise<{ res: Response; body: unknown } | null> {
  try {
    const res = await fetch(req);
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep raw text — some errors aren't JSON */ }
    return { res, body };
  } catch {
    return null; // DNS/network failure: the provider's base URL may have moved
  }
}

/** Which provider accepts this key? Named vars try their namesake first. */
async function fingerprint(varName: string, key: string, lastErrors: string[]): Promise<Probe | null> {
  const hinted = varName.toLowerCase().replace(/_api_key$|_key$/, "").replace(/[^a-z0-9]/g, "");
  const ordered = [...CANDIDATES].sort(
    (a, b) => Number(b.id.startsWith(hinted) || hinted.startsWith(b.id)) - Number(a.id.startsWith(hinted) || hinted.startsWith(a.id))
  );
  for (const c of ordered) {
    const hints = c.id.startsWith(hinted) || hinted.startsWith(c.id);
    // A provider with no `verify` can only be claimed by NAME, never by guessing.
    // Several serve their sports catalogue unauthenticated and answer 200 to any
    // key, so letting them compete for an unnamed key means the first such entry
    // swallows every key in the file — which is exactly what happened here.
    if (!c.verify && !hints) continue; // see comment above
    const out = await tryJson(c.request(key, c.ping));
    // A 200 alone isn't identification: a wrong base URL often lands on a marketing
    // page or a CDN 200 with an HTML body. Real API responses parse to an object or
    // array — a body still sitting as a raw string means we did not reach an API.
    if (out && out.res.ok && (typeof out.body !== "object" || out.body === null)) {
      lastErrors.push(`${c.label}: HTTP 200 but non-JSON body (wrong base URL?)`);
      continue;
    }
    if (!out || !out.res.ok) {
      if (out) lastErrors.push(`${c.label}: HTTP ${out.res.status} ${String(JSON.stringify(out.body)).slice(0, 120)}`);
      continue;
    }
    if (c.verify) {
      const check = await tryJson(c.request(key, c.verify.path, c.verify.params));
      if (!check || !check.res.ok) {
        if (check) lastErrors.push(`${c.label}: HTTP ${check.res.status} ${String(JSON.stringify(check.body)).slice(0, 120)}`);
        continue;
      }
    }
    return c;
  }
  return null;
}

/** Book coverage for an Odds-API-shaped payload, split by what the books actually are. */
function coverage(events: any[]): { events: number; byBook: Map<string, number> } {
  const byBook = new Map<string, number>();
  for (const e of events) {
    for (const b of e.bookmakers ?? []) byBook.set(b.key, (byBook.get(b.key) ?? 0) + 1);
  }
  return { events: events.length, byBook };
}

function reportCoverage(title: string, events: number, byBook: Map<string, number>): void {
  console.log(`\n  ${title} — ${events} events`);
  if (!byBook.size) return console.log("    (no books quoted)");
  const groups: Record<string, string[]> = { mainstream: [], sharp: [], dfs: [], offshore: [], other: [] };
  for (const [book, n] of [...byBook].sort((a, b) => b[1] - a[1])) {
    groups[classify(book)].push(`${book} ${n}/${events}`);
  }
  for (const [g, list] of Object.entries(groups)) {
    if (list.length) console.log(`    ${g.padEnd(10)} ${list.join(", ")}`);
  }
  const main = [...byBook].filter(([b]) => classify(b) === "mainstream");
  const best = main.length ? Math.max(...main.map(([, n]) => n)) : 0;
  console.log(`    → mainstream books present: ${main.length}, best coverage ${best}/${events}`);
}

async function profile(c: Probe, key: string): Promise<void> {
  console.log(`\n${"─".repeat(70)}\n${c.label}`);

  const ping = await tryJson(c.request(key, c.ping));
  if (!ping) return console.log("  unreachable");
  console.log(`  auth: HTTP ${ping.res.status}   quota: ${quotaFrom(ping.res)}`);
  if (Array.isArray(ping.body)) console.log(`  ${c.ping} → ${ping.body.length} entries`);

  if (c.oddsApiShaped && c.sportKey) {
    const main = await tryJson(
      c.request(key, `/sports/${c.sportKey}/odds`, { markets: "h2h,spreads,totals", oddsFormat: "american", regions: "us" })
    );
    if (main?.res.ok && Array.isArray(main.body)) {
      const { events, byBook } = coverage(main.body);
      reportCoverage("GAME LINES", events, byBook);
      console.log(`    credits this call: ${quotaFrom(main.res)}`);
    } else {
      console.log(`\n  GAME LINES — failed: HTTP ${main?.res.status} ${JSON.stringify(main?.body).slice(0, 160)}`);
    }
  }

  for (const [name, spec] of Object.entries(c.extras ?? {})) {
    const out = await tryJson(c.request(key, spec.path, spec.params));
    if (!out) { console.log(`\n  ${name}: unreachable`); continue; }
    if (!out.res.ok) {
      // A refusal is a finding: this is how ParlayAPI's total lack of alt lines
      // surfaced (400 INVALID_MARKET), which no pricing page mentions.
      console.log(`\n  ${name}: HTTP ${out.res.status} — ${JSON.stringify(out.body).slice(0, 200)}`);
      continue;
    }
    const rows = out.body as any[];
    if (!Array.isArray(rows)) { console.log(`\n  ${name}: ok, non-array shape (needs mapping)`); continue; }
    if (name === "props" && rows.length && rows[0].bookmaker) {
      // Parlay's flat prop row shape: one row per (event, book, player, market).
      const byBook = new Map<string, Set<string>>();
      for (const r of rows) {
        if (!byBook.has(r.bookmaker)) byBook.set(r.bookmaker, new Set());
        byBook.get(r.bookmaker)!.add(r.event_id);
      }
      const total = new Set(rows.map((r) => r.event_id)).size;
      reportCoverage("PLAYER PROPS", total, new Map([...byBook].map(([b, s]) => [b, s.size])));
    } else {
      console.log(`\n  ${name}: ok — ${rows.length} rows`);
    }
    console.log(`    ${quotaFrom(out.res)}`);
  }
}

// Wrapped rather than top-level await: tsx transforms this file as CJS.
async function main(): Promise<void> {
  const keys = Object.entries(process.env)
    .filter(([k, v]) => /_API_KEY(_\d+)?$/.test(k) && v && v.trim())
    .map(([k, v]) => [k, v!.trim()] as const);

  if (!keys.length) {
    console.log("No *_API_KEY values found. Add them to .env (see the placeholder block) and re-run.");
    return;
  }

  console.log(`Probing ${keys.length} key(s): ${keys.map(([k]) => k).join(", ")}`);
  for (const [varName, key] of keys) {
    const errors: string[] = [];
    const c = await fingerprint(varName, key, errors);
    if (!c) {
      console.log(`\n${"─".repeat(70)}\n${varName}: no candidate provider accepted this key.`);
      console.log("  Either it's a provider not in CANDIDATES, or the key is expired/out of quota.");
      // The refusals themselves say which: "invalid key" vs "quota exceeded" are
      // very different problems, and the message is the only place that shows.
      for (const e of errors.slice(0, 6)) console.log(`    ${e}`);
      continue;
    }
    console.log(`\n${varName} → identified as ${c.label}`);
    await profile(c, key);
  }
}

void main();
