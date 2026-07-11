/**
 * One source of truth for every piece of betting jargon the app shows. The
 * `<InfoTip>` popovers, the `/learn` glossary page, and any inline helper copy
 * all read from here, so a term is defined once and stays consistent.
 *
 * `short` must be a single plain-language sentence (it renders inside a small
 * tap popover). `long` is an optional second sentence with extra nuance, shown
 * only on `/learn`. Write for someone who has never used a betting tool —
 * without dumbing it down for someone who has.
 */
export type GlossaryCategory = "value" | "odds" | "bets" | "form" | "model" | "getting-around";

export interface GlossaryEntry {
  id: string;
  term: string;
  short: string;
  long?: string;
  category: GlossaryCategory;
}

export const GLOSSARY_CATEGORIES: { key: GlossaryCategory; label: string; blurb: string }[] = [
  { key: "value", label: "Value & EV", blurb: "How we tell a good price from a bad one." },
  { key: "odds", label: "Odds & prices", blurb: "Reading the numbers the books put up." },
  { key: "bets", label: "Bet types", blurb: "The kinds of bets you can shop." },
  { key: "form", label: "Hit rates & form", blurb: "What a player or team has been doing lately." },
  { key: "model", label: "The ARCHR Edge model", blurb: "ARCHR Edge's own projections, and how far to trust them." },
  { key: "getting-around", label: "Getting around", blurb: "The words for the app's own screens." },
];

export const GLOSSARY: GlossaryEntry[] = [
  // ── Value & EV ──────────────────────────────────────────────────────────
  {
    id: "ev",
    term: "EV (expected value)",
    short: "Whether a price is in your favor or the book's over the long run — positive EV means the number is better than the true odds suggest.",
    long: "It doesn't predict one bet's result; it measures whether the price itself is a good deal if you made it many times.",
    category: "value",
  },
  {
    id: "market-ev",
    term: "Market EV",
    short: "How good a price is versus the market's own fair price, after stripping out the book's built-in margin — positive means you're getting a better number than the market average.",
    category: "value",
  },
  {
    id: "hist-ev",
    term: "Hist EV (historical)",
    short: "A rough edge estimate based on how often the bet has hit recently — a small-sample, directional hint only, with no adjustment for opponent, park, or pitcher.",
    category: "value",
  },
  {
    id: "archer-ev",
    term: "ARCHR Edge",
    short: "How a price compares to the ARCHR Edge model's own projection for the game, rather than to the market.",
    category: "value",
  },
  {
    id: "value",
    term: "Value / +value",
    short: "A price that's better than the true odds — a '+value' play is one where the number is in your favor. Same idea as positive EV.",
    category: "value",
  },
  {
    id: "de-vig",
    term: "De-vig / de-vigged",
    short: "Books bake a profit margin (the 'vig') into every price; de-vigging strips it out to estimate the true, fair probability — the baseline we measure value against.",
    long: "It's why two books can both look like they favor the home team yet still disagree on the fair price.",
    category: "value",
  },
  {
    id: "edge",
    term: "Edge (pt)",
    short: "The gap between ARCHR Edge's estimated chance and the market's, in percentage points — e.g. '+5.0pt' means ARCHR Edge likes the side 5 points more than the market does.",
    category: "value",
  },

  // ── Odds & prices ───────────────────────────────────────────────────────
  {
    id: "american-odds",
    term: "American odds",
    short: "US-style prices. A minus number (-150) is the favorite and how much you risk to win $100; a plus number (+130) is the underdog and how much $100 would win.",
    category: "odds",
  },
  {
    id: "line-shopping",
    term: "Line shopping",
    short: "Comparing the exact same bet across sportsbooks to grab the best available price — the core habit behind finding value.",
    category: "odds",
  },
  {
    id: "best-price",
    term: "Best price",
    short: "The highest odds for a bet across the books we track — the most you'd win for the same wager.",
    category: "odds",
  },
  {
    id: "odds-range",
    term: "Odds range / price band",
    short: "A filter that hides bets outside the price range you care about, so you can focus on, say, only underdogs or only near-even bets.",
    category: "odds",
  },
  {
    id: "book",
    term: "Book / sportsbook",
    short: "A licensed betting operator (DraftKings, FanDuel, BetMGM…). Different books post different prices, which is why shopping them matters.",
    category: "odds",
  },

  // ── Bet types ───────────────────────────────────────────────────────────
  {
    id: "moneyline",
    term: "Moneyline (ML)",
    short: "A straight bet on who wins, with no point spread — just pick the side.",
    category: "bets",
  },
  {
    id: "spread",
    term: "Spread",
    short: "A margin handicap: the favorite must win by more than the spread, or the underdog can lose by less than it (or win outright) to cash.",
    category: "bets",
  },
  {
    id: "total",
    term: "Total (over/under)",
    short: "A bet on a combined number — like total runs in a game — where you take the Over or the Under of that line.",
    category: "bets",
  },
  {
    id: "prop",
    term: "Player prop",
    short: "A bet on one player's stat line — hits, strikeouts, total bases — rather than the game's outcome.",
    category: "bets",
  },
  {
    id: "alt-line",
    term: "Alt lines / increments",
    short: "The same bet offered at different numbers than the main one, with prices that shift to match — 'seek' across them (0.5+, 1.5+, 2.5+) to find the number you want.",
    category: "bets",
  },
  {
    id: "three-way",
    term: "3-way market",
    short: "A market with three outcomes — home, draw, or away — used in soccer, where a tie is a real result.",
    category: "bets",
  },

  // ── Hit rates & form ────────────────────────────────────────────────────
  {
    id: "hit-rate",
    term: "Hit rate",
    short: "How often a player has cleared this number in their recent games — 7/10 = 70%. It's history, not a prediction.",
    category: "form",
  },
  {
    id: "last-n",
    term: "L5 / L10 / L15",
    short: "The player's last 5, 10, or 15 games. Shorter windows react faster to a hot or cold streak; longer windows are steadier.",
    category: "form",
  },
  {
    id: "handedness-split",
    term: "vs LHP / vs RHP",
    short: "A split by the pitcher's throwing hand (left- or right-handed) — batters often perform differently against each, and the highlighted one is today's matchup.",
    category: "form",
  },
  {
    id: "graded",
    term: "Graded",
    short: "A bet that's been settled win or loss once the game went final — how hit rates get counted.",
    category: "form",
  },

  // ── Archer's models ─────────────────────────────────────────────────────
  {
    id: "model-lean",
    term: "Model lean",
    short: "How far the ARCHR Edge model tips away from a coin flip toward one side — a bigger lean means a stronger model opinion.",
    category: "model",
  },
  {
    id: "market-vs-model",
    term: "Market vs Model",
    short: "Two ways to read value: Market compares the best price to the market's fair price; Model compares it to ARCHR Edge's own projection.",
    category: "model",
  },
  {
    id: "win-probability",
    term: "Win probability",
    short: "The ARCHR Edge model's estimated chance each side wins (recent form, pitching, and so on) — an estimate, not a guarantee.",
    category: "model",
  },
  {
    id: "expected-runs",
    term: "Expected runs",
    short: "ARCHR Edge's projected runs per team and game total — a directional heuristic from pitching and form, not a precise forecast.",
    category: "model",
  },
  {
    id: "fighter-math",
    term: "Fighter math",
    short: "ARCHR Edge's transparent, hand-tuned way to estimate a fight from career form, shared opponents, and style edges — directional, not a backtested betting model.",
    category: "model",
  },
  {
    id: "era",
    term: "ERA",
    short: "Earned run average — the runs a pitcher allows per 9 innings. Lower is better.",
    category: "model",
  },

  // ── Getting around ──────────────────────────────────────────────────────
  {
    id: "slate",
    term: "The Slate",
    short: "All of today's games across every sport, gathered in one place.",
    category: "getting-around",
  },
  {
    id: "pool",
    term: "The pool",
    short: "Every priced bet on the day pooled into one sortable board, so you can filter by price and hunt value across sports at once.",
    category: "getting-around",
  },
  {
    id: "slip",
    term: "Bet slip",
    short: "Your working list of picks — add bets to see the combined odds and payout math. It's research only and never places a real bet.",
    category: "getting-around",
  },
  {
    id: "parlay",
    term: "Parlay",
    short: "Several picks combined into one bet — a bigger payout, but every leg has to hit.",
    category: "getting-around",
  },
];

export const GLOSSARY_BY_ID: Record<string, GlossaryEntry> = Object.fromEntries(
  GLOSSARY.map((entry) => [entry.id, entry])
);
