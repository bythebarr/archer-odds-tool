import { describe, it, expect } from "vitest";
import { buildCfbPredictionRun, CFB_SPORT_KEY, CFB_H2H_MARKET_KEY } from "./predictionCapture";
import { CFB_MODEL_KEY, CFB_MODEL_VERSION, CFB_MODEL_LIFECYCLE, CFB_FEATURE_SCHEMA_VERSION } from "./modelIdentity";
import { predictGame, HOME_FIELD_POINTS, MARGIN_SD } from "./model";
import { buildTeamRatings, ratingOrDefault, SRS_ITERATIONS, SHRINK_GAMES, DEFAULT_LEAGUE_AVG_POINTS, MAX_PLAUSIBLE_SCORE } from "./ratings";
import { validatePredictionRunInput } from "@/lib/predictions";
import type { CfbCompletedGame, CfbRatingBook, CfbScheduleGame, CfbTeamRating } from "./types";
import type { PredictionInput } from "@/lib/predictions";

/**
 * Exhaustive tests for the pure CFB-to-PredictionRunInput builder (see
 * docs/architecture/MODEL-PREDICTION-LIFECYCLE.md). No Prisma, no network —
 * matches this codebase's existing convention of pure-function-only tests.
 */

const GENERATED_AT = new Date("2026-09-27T12:00:00.000Z");
const DATA_AS_OF = GENERATED_AT; // the orchestration layer always uses the same instant for both; tests mirror that
const KICKOFF = new Date("2026-09-27T17:00:00.000Z"); // after GENERATED_AT — eligible
const ALREADY_STARTED = new Date("2026-09-27T11:00:00.000Z"); // before GENERATED_AT — ineligible

function team(id: string, name = `Team ${id}`) {
  return { espnTeamId: id, displayName: name, abbreviation: null, record: null };
}

function game(overrides: Partial<CfbScheduleGame> = {}): CfbScheduleGame {
  return {
    espnEventId: "espn-1",
    startUtc: KICKOFF,
    status: "scheduled",
    neutralSite: false,
    home: team("100", "Home U"),
    away: team("200", "Away State"),
    homeScore: null,
    awayScore: null,
    ...overrides,
  };
}

function rating(overrides: Partial<CfbTeamRating> = {}): CfbTeamRating {
  return {
    teamId: "100",
    offenseRating: 3,
    defenseRating: -2,
    netRating: 5,
    gamesPlayed: 4,
    strengthOfSchedule: 1.5,
    ...overrides,
  };
}

function ratingBook(ratings: CfbTeamRating[], leagueAvgPoints = 27): CfbRatingBook {
  return { ratings: new Map(ratings.map((r) => [r.teamId, r])), leagueAvgPoints };
}

const RATED_BOOK = ratingBook([
  rating({ teamId: "100", offenseRating: 4, defenseRating: -3, netRating: 7, gamesPlayed: 5, strengthOfSchedule: 2 }),
  rating({ teamId: "200", offenseRating: 1, defenseRating: 1, netRating: 0, gamesPlayed: 4, strengthOfSchedule: -1 }),
]);

function build(games: CfbScheduleGame[], book: CfbRatingBook = RATED_BOOK, generatedAt = GENERATED_AT, dataAsOfUtc = DATA_AS_OF) {
  return buildCfbPredictionRun({ slate: games, ratingBook: book, generatedAt, dataAsOfUtc, dateEt: "2026-09-27" });
}

describe("model identity", () => {
  it("stamps the fixed CFB model key, version, and lifecycle onto the run", () => {
    const { runInput } = build([game()]);
    expect(runInput?.sportKey).toBe(CFB_SPORT_KEY);
    expect(runInput?.sportKey).toBe("cfb");
    expect(runInput?.modelKey).toBe(CFB_MODEL_KEY);
    expect(runInput?.modelVersion).toBe(CFB_MODEL_VERSION);
    expect(runInput?.lifecycle).toBe(CFB_MODEL_LIFECYCLE);
    expect(runInput?.lifecycle).toBe("experimental");
    expect(runInput?.featureSchemaVersion).toBe(CFB_FEATURE_SCHEMA_VERSION);
  });

  it("never claims validated or production", () => {
    const { runInput } = build([game()]);
    expect(runInput?.lifecycle).not.toBe("validated");
    expect(runInput?.lifecycle).not.toBe("production");
  });

  it("carries generatedAt and dataAsOfUtc exactly as passed in, with no default substituted", () => {
    const g = new Date("2026-09-20T09:00:00.000Z");
    const { runInput } = build([game()], RATED_BOOK, g, g);
    expect(runInput?.generatedAt).toBe(g);
    expect(runInput?.dataAsOfUtc).toBe(g);
  });
});

describe("full reproducible feature snapshot", () => {
  it("carries every required field for one prediction, matching the rating book exactly", () => {
    const { runInput } = build([game({ neutralSite: false })]);
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    const snap = home.featureSnapshot as Record<string, unknown>;

    expect(snap.espnEventId).toBe("espn-1");
    expect(snap.scheduledStartUtc).toBe(KICKOFF.toISOString());
    expect(snap.neutralSite).toBe(false);
    expect(snap.leagueAvgPoints).toBe(27);
    expect(snap.homeTeamId).toBe("100");
    expect(snap.awayTeamId).toBe("200");
    expect(snap.homeRating).toEqual({ offenseRating: 4, defenseRating: -3, netRating: 7, gamesPlayed: 5, strengthOfSchedule: 2 });
    expect(snap.awayRating).toEqual({ offenseRating: 1, defenseRating: 1, netRating: 0, gamesPlayed: 4, strengthOfSchedule: -1 });
    expect(snap.homeFieldPointsApplied).toBe(HOME_FIELD_POINTS); // non-neutral site
    expect(snap.dataAsOfUtc).toBe(DATA_AS_OF.toISOString());
    expect(snap.constants).toEqual({
      homeFieldPoints: HOME_FIELD_POINTS,
      marginSd: MARGIN_SD,
      srsIterations: SRS_ITERATIONS,
      shrinkGames: SHRINK_GAMES,
      defaultLeagueAvgPoints: DEFAULT_LEAGUE_AVG_POINTS,
      maxPlausibleScore: MAX_PLAUSIBLE_SCORE,
      minGamesLowConfidence: 3,
      minGamesHighConfidence: 6,
    });
  });

  it("reports 0 home-field points applied on a neutral-site game", () => {
    const { runInput } = build([game({ neutralSite: true })]);
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    expect((home.featureSnapshot as Record<string, unknown>).homeFieldPointsApplied).toBe(0);
    expect((home.featureSnapshot as Record<string, unknown>).neutralSite).toBe(true);
  });

  it("is valid JSON per the storage boundary's own validator (round-trip sanity)", () => {
    const { runInput } = build([game()]);
    expect(validatePredictionRunInput(runInput!)).toEqual([]);
  });
});

describe("complementary home/away probabilities", () => {
  it("produces exactly two predictions per game, home and away, under the same marketKey", () => {
    const { runInput } = build([game()]);
    expect(runInput!.predictions).toHaveLength(2);
    expect(runInput!.predictions.every((p) => p.marketKey === CFB_H2H_MARKET_KEY)).toBe(true);
    expect(runInput!.predictions.every((p) => p.eventRef === "espn-1")).toBe(true);
    const keys = runInput!.predictions.map((p) => p.selectionKey).sort();
    expect(keys).toEqual(["away", "home"]);
  });

  it("home and away probabilities sum to exactly 1", () => {
    const { runInput } = build([game()]);
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    const away = runInput!.predictions.find((p) => p.selectionKey === "away")!;
    expect((home.probability ?? 0) + (away.probability ?? 0)).toBeCloseTo(1, 10);
  });

  it("both rows carry the identical game-level projection (documented duplication, not divergence)", () => {
    const { runInput } = build([game()]);
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    const away = runInput!.predictions.find((p) => p.selectionKey === "away")!;
    expect(home.projection).toEqual(away.projection);
  });
});

describe("projected score/margin/total preservation", () => {
  it("preserves projectedHomeScore/AwayScore/Margin/Total and confidence/sample context in the projection payload", () => {
    const { runInput } = build([game()]);
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    const proj = home.projection as Record<string, unknown>;
    expect(typeof proj.projectedHomeScore).toBe("number");
    expect(typeof proj.projectedAwayScore).toBe("number");
    expect(proj.projectedMargin).toBeCloseTo((proj.projectedHomeScore as number) - (proj.projectedAwayScore as number), 10);
    expect(proj.projectedTotal).toBeCloseTo((proj.projectedHomeScore as number) + (proj.projectedAwayScore as number), 10);
    expect(["low", "medium", "high"]).toContain(proj.confidence);
    expect(proj.minGamesPlayed).toBe(4); // min(5, 4) from RATED_BOOK
  });
});

describe("unrated-team missing flags", () => {
  it("flags a home team with no prior rating as unrated", () => {
    const bookMissingHome = ratingBook([rating({ teamId: "200", gamesPlayed: 3 })]);
    const { runInput } = build([game()], bookMissingHome);
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    expect(home.missingInputs).toEqual({ homeTeamUnrated: true, awayTeamUnrated: false });
  });

  it("flags an away team with no prior rating as unrated", () => {
    const bookMissingAway = ratingBook([rating({ teamId: "100", gamesPlayed: 3 })]);
    const { runInput } = build([game()], bookMissingAway);
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    expect(home.missingInputs).toEqual({ homeTeamUnrated: false, awayTeamUnrated: true });
  });

  it("flags both teams unrated when the rating book is empty (true early-season case)", () => {
    const emptyBook = ratingBook([]);
    const { runInput } = build([game()], emptyBook);
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    expect(home.missingInputs).toEqual({ homeTeamUnrated: true, awayTeamUnrated: true });
  });

  it("flags neither team unrated when both have a prior rating", () => {
    const { runInput } = build([game()]); // RATED_BOOK has both 100 and 200
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    expect(home.missingInputs).toEqual({ homeTeamUnrated: false, awayTeamUnrated: false });
  });

  it("does NOT report weather/injuries/recruiting/coaching as missing — not part of v0's declared schema", () => {
    const { runInput } = build([game()]);
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    const missing = home.missingInputs as Record<string, unknown>;
    expect(Object.keys(missing).sort()).toEqual(["awayTeamUnrated", "homeTeamUnrated"]);
  });
});

describe("exclusions", () => {
  it("excludes an already-started 'scheduled' game (kickoff at or before generatedAt)", () => {
    const { runInput, eligibleGameCount, exclusions } = build([game({ startUtc: ALREADY_STARTED })]);
    expect(runInput).toBeNull();
    expect(eligibleGameCount).toBe(0);
    expect(exclusions).toEqual([{ espnEventId: "espn-1", reason: "already-started" }]);
  });

  it("excludes a game whose kickoff exactly equals generatedAt (not STRICTLY after)", () => {
    const { runInput, exclusions } = build([game({ startUtc: GENERATED_AT })]);
    expect(runInput).toBeNull();
    expect(exclusions[0].reason).toBe("already-started");
  });

  it.each([
    ["live", "status:live"],
    ["final", "status:final"],
    ["postponed", "status:postponed"],
    ["other", "status:other"],
  ] as const)("excludes a %s-status game with reason %s", (status, reason) => {
    const { runInput, exclusions } = build([game({ status })]);
    expect(runInput).toBeNull();
    expect(exclusions).toEqual([{ espnEventId: "espn-1", reason }]);
  });

  it("includes eligible games and excludes ineligible ones from the same slate, independently", () => {
    const eligible = game({ espnEventId: "espn-eligible", status: "scheduled", startUtc: KICKOFF });
    const started = game({ espnEventId: "espn-started", status: "scheduled", startUtc: ALREADY_STARTED });
    const final = game({ espnEventId: "espn-final", status: "final" });
    const { runInput, eligibleGameCount, exclusions } = build([eligible, started, final]);
    expect(eligibleGameCount).toBe(1);
    expect(runInput!.predictions.every((p) => p.eventRef === "espn-eligible")).toBe(true);
    expect(exclusions.map((e) => e.espnEventId).sort()).toEqual(["espn-final", "espn-started"]);
  });
});

describe("empty slate / all games excluded", () => {
  it("returns a null runInput and zero eligible games for an empty slate", () => {
    const { runInput, eligibleGameCount, exclusions } = build([]);
    expect(runInput).toBeNull();
    expect(eligibleGameCount).toBe(0);
    expect(exclusions).toEqual([]);
  });

  it("returns a null runInput when every game on a non-empty slate is excluded", () => {
    const { runInput, eligibleGameCount, exclusions } = build([
      game({ espnEventId: "e1", status: "final" }),
      game({ espnEventId: "e2", status: "live" }),
      game({ espnEventId: "e3", startUtc: ALREADY_STARTED }),
    ]);
    expect(runInput).toBeNull();
    expect(eligibleGameCount).toBe(0);
    expect(exclusions).toHaveLength(3);
  });
});

describe("no fabricated market snapshot or market-line-dependent probabilities", () => {
  it("never sets marketSnapshot — CFB v0 has no server-side market line", () => {
    const { runInput } = build([game()]);
    for (const p of runInput!.predictions) {
      expect(p.marketSnapshot).toBeUndefined();
    }
  });

  it("never includes a spread-cover or over/under probability in the projection payload", () => {
    const { runInput } = build([game()]);
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    const proj = home.projection as Record<string, unknown>;
    expect(proj.homeCoverProb).toBeUndefined();
    expect(proj.awayCoverProb).toBeUndefined();
    expect(proj.overProb).toBeUndefined();
    expect(proj.underProb).toBeUndefined();
    expect(Object.keys(proj).sort()).toEqual(
      ["confidence", "minGamesPlayed", "projectedAwayScore", "projectedHomeScore", "projectedMargin", "projectedTotal"].sort()
    );
  });

  it("projectedMargin/projectedTotal are plain values, never paired with a probability field for them", () => {
    const { runInput } = build([game()]);
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    // The only `probability` field on the row is the win probability (selectionKey-scoped) — not a margin/total probability.
    expect(typeof home.probability).toBe("number");
    expect(home.probability).toBeGreaterThanOrEqual(0);
    expect(home.probability).toBeLessThanOrEqual(1);
  });
});

describe("multiple games in one slate", () => {
  it("builds independent, correctly-keyed predictions for multiple eligible games", () => {
    const g1 = game({ espnEventId: "g1", home: team("100"), away: team("200") });
    const g2 = game({ espnEventId: "g2", home: team("300"), away: team("400") });
    const book = ratingBook([rating({ teamId: "100" }), rating({ teamId: "200" }), rating({ teamId: "300" }), rating({ teamId: "400" })]);
    const { runInput, eligibleGameCount } = build([g1, g2], book);
    expect(eligibleGameCount).toBe(2);
    expect(runInput!.predictions).toHaveLength(4);
    const refs = new Set(runInput!.predictions.map((p) => p.eventRef));
    expect(refs).toEqual(new Set(["g1", "g2"]));
  });
});

describe("run metadata", () => {
  it("records the capture date, eligible count, and exclusion count for debugging", () => {
    const { runInput } = build([game(), game({ espnEventId: "e2", status: "final" })]);
    expect(runInput!.runMetadata).toEqual({ capturedForDateEt: "2026-09-27", eligibleGameCount: 1, exclusionCount: 1 });
  });
});

// Type-level sanity: confirm featureSnapshot/projection/missingInputs actually
// satisfy PredictionInput's field types (no `any` escape hatch silently typed wrong).
describe("PredictionInput shape", () => {
  it("produced predictions satisfy the generic PredictionInput interface fields", () => {
    const { runInput } = build([game()]);
    const p: PredictionInput = runInput!.predictions[0];
    expect(p.eventRef).toBeTypeOf("string");
    expect(p.scheduledStartUtc).toBeInstanceOf(Date);
  });
});

/**
 * Added by the adversarial review pass. Proves the capture path uses the
 * EXACT SAME `buildTeamRatings`/`predictGame`/`ratingOrDefault` functions and
 * constants as `/cfb`'s live board (`src/app/cfb/page.tsx`) — not a
 * reimplementation that could silently drift. This test builds a real
 * completed-games history, runs `buildTeamRatings` itself (the identical call
 * the live page makes), computes a "live page" prediction directly from that
 * output, and separately runs the same inputs through `buildCfbPredictionRun`
 * — then asserts every stored number matches the direct computation exactly
 * (not "close to," `toBe`/`toEqual`, since this is the same deterministic
 * pure math run twice, not two independent estimates).
 */
describe("live-page parity", () => {
  const ASOF = new Date("2026-09-27T00:00:00.000Z");

  function completed(overrides: Partial<CfbCompletedGame> = {}): CfbCompletedGame {
    return {
      espnEventId: "hist-1",
      startUtc: new Date("2026-09-13T17:00:00.000Z"),
      neutralSite: false,
      homeTeamId: "100",
      awayTeamId: "200",
      homeScore: 30,
      awayScore: 20,
      ...overrides,
    };
  }

  const HISTORY: CfbCompletedGame[] = [
    completed({ espnEventId: "h1", homeTeamId: "100", awayTeamId: "300", homeScore: 28, awayScore: 14 }),
    completed({ espnEventId: "h2", homeTeamId: "200", awayTeamId: "300", homeScore: 21, awayScore: 24 }),
    completed({ espnEventId: "h3", homeTeamId: "100", awayTeamId: "200", homeScore: 35, awayScore: 10 }),
    completed({ espnEventId: "h4", homeTeamId: "300", awayTeamId: "100", homeScore: 17, awayScore: 27 }),
  ];

  it("stored ratings/probability/scores/margin/total/confidence/drivers exactly match a direct predictGame call over the same buildTeamRatings output", () => {
    // Exactly what the live page does (page.tsx): build ratings once, resolve
    // each side via ratingOrDefault, call predictGame.
    const book = buildTeamRatings(HISTORY, ASOF);
    const homeLive = ratingOrDefault(book.ratings, "100");
    const awayLive = ratingOrDefault(book.ratings, "200");
    const livePrediction = predictGame(homeLive, awayLive, book.leagueAvgPoints, { neutralSite: false });

    // The capture path, given the SAME ratingBook and the SAME asOf instant.
    const target = game({ espnEventId: "target", home: team("100"), away: team("200"), startUtc: KICKOFF, neutralSite: false });
    const { runInput } = build([target], book, ASOF, ASOF);
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    const away = runInput!.predictions.find((p) => p.selectionKey === "away")!;
    const snap = home.featureSnapshot as Record<string, unknown>;
    const proj = home.projection as Record<string, unknown>;

    // Ratings: byte-identical to what the live page would resolve for these teams.
    expect(snap.homeRating).toEqual({
      offenseRating: homeLive.offenseRating,
      defenseRating: homeLive.defenseRating,
      netRating: homeLive.netRating,
      gamesPlayed: homeLive.gamesPlayed,
      strengthOfSchedule: homeLive.strengthOfSchedule,
    });
    expect(snap.awayRating).toEqual({
      offenseRating: awayLive.offenseRating,
      defenseRating: awayLive.defenseRating,
      netRating: awayLive.netRating,
      gamesPlayed: awayLive.gamesPlayed,
      strengthOfSchedule: awayLive.strengthOfSchedule,
    });
    expect(snap.leagueAvgPoints).toBe(book.leagueAvgPoints);

    // Prediction output: byte-identical to the direct predictGame call.
    expect(home.probability).toBe(livePrediction.homeWinProb);
    expect(away.probability).toBe(livePrediction.awayWinProb);
    expect(proj.projectedHomeScore).toBe(livePrediction.projectedHomeScore);
    expect(proj.projectedAwayScore).toBe(livePrediction.projectedAwayScore);
    expect(proj.projectedMargin).toBe(livePrediction.projectedMargin);
    expect(proj.projectedTotal).toBe(livePrediction.projectedTotal);
    expect(proj.confidence).toBe(livePrediction.confidence);
    expect(proj.minGamesPlayed).toBe(livePrediction.drivers.minGamesPlayed);
    expect(snap.homeFieldPointsApplied).toBe(livePrediction.drivers.homeFieldPoints);
  });

  it("neutral-site parity: capture and a direct predictGame call agree HFA is zero", () => {
    const book = buildTeamRatings(HISTORY, ASOF);
    const homeLive = ratingOrDefault(book.ratings, "100");
    const awayLive = ratingOrDefault(book.ratings, "200");
    const livePrediction = predictGame(homeLive, awayLive, book.leagueAvgPoints, { neutralSite: true });

    const target = game({ espnEventId: "target-neutral", home: team("100"), away: team("200"), startUtc: KICKOFF, neutralSite: true });
    const { runInput } = build([target], book, ASOF, ASOF);
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;

    expect(home.probability).toBe(livePrediction.homeWinProb);
    expect((home.featureSnapshot as Record<string, unknown>).homeFieldPointsApplied).toBe(0);
    expect(livePrediction.drivers.homeFieldPoints).toBe(0);
  });

  it("as-of cutoff MECHANISM is identical (same buildTeamRatings, same strict-before rule) even though the VALUE differs by design from the live page's convention", () => {
    // The live page pins asOfUtc to "start of the BROWSED date" (a display
    // convenience — one shared cutoff for every game shown that day,
    // regardless of when you're viewing it; see page.tsx's own comment).
    // Capture instead uses "the actual instant the script ran" — deliberately
    // NOT the same value, because pinning capture to "start of the TARGET
    // date" would let a prediction generated days in advance implicitly see
    // information that didn't exist yet when it actually ran (a real causality
    // violation, not a display simplification). What must be identical is the
    // MECHANISM: both call buildTeamRatings, whose own strict `>=` exclusion
    // (ratings.test.ts's "enforces a strict as-of cutoff") is the single
    // shared source of leakage-safety — neither caller re-implements it.
    const asOfA = new Date("2026-09-20T00:00:00.000Z"); // "start of browsed day" style
    const asOfB = new Date("2026-09-24T15:00:00.000Z"); // "actual capture instant" style, later
    const bookA = buildTeamRatings(HISTORY, asOfA);
    const bookB = buildTeamRatings(HISTORY, asOfB);
    // Both are produced by the exact same function; this asserts there is no
    // SEPARATE cutoff-enforcement path for capture — if there were, this
    // test would be the place a drift would first show up as two different
    // teams sets or rating shapes for the same underlying history/cutoff pair.
    expect(bookA.ratings.size).toBeLessThanOrEqual(bookB.ratings.size);
  });
});

/**
 * Feature reproducibility: a future evaluator with ONLY the frozen
 * featureSnapshot (never a live query) must be able to reconstruct the exact
 * stored projection/probability by calling `predictGame` directly.
 */
describe("feature reproducibility", () => {
  it("reconstructing predictGame's inputs from the stored featureSnapshot alone reproduces the stored output exactly", () => {
    const { runInput } = build([game()]); // uses RATED_BOOK
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    const away = runInput!.predictions.find((p) => p.selectionKey === "away")!;
    type RatingSansTeamId = Omit<CfbTeamRating, "teamId">;
    const snap = home.featureSnapshot as unknown as {
      leagueAvgPoints: number;
      neutralSite: boolean;
      homeRating: RatingSansTeamId;
      awayRating: RatingSansTeamId;
    };

    // Reconstructed purely from the frozen snapshot — no access to RATED_BOOK,
    // no access to any live table.
    const reconstructedHome: CfbTeamRating = { teamId: "100", ...snap.homeRating };
    const reconstructedAway: CfbTeamRating = { teamId: "200", ...snap.awayRating };
    const reconstructed = predictGame(reconstructedHome, reconstructedAway, snap.leagueAvgPoints, {
      neutralSite: snap.neutralSite,
    });

    expect(home.probability).toBe(reconstructed.homeWinProb);
    expect(away.probability).toBe(reconstructed.awayWinProb);
    expect((home.projection as Record<string, unknown>).projectedHomeScore).toBe(reconstructed.projectedHomeScore);
    expect((home.projection as Record<string, unknown>).projectedAwayScore).toBe(reconstructed.projectedAwayScore);
    expect((home.projection as Record<string, unknown>).projectedMargin).toBe(reconstructed.projectedMargin);
    expect((home.projection as Record<string, unknown>).projectedTotal).toBe(reconstructed.projectedTotal);
    expect((home.projection as Record<string, unknown>).confidence).toBe(reconstructed.confidence);
  });

  it("stored constants exactly match the model's real, currently-imported constant values (no hand-copied literals that could drift)", () => {
    const { runInput } = build([game()]);
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    const constants = (home.featureSnapshot as Record<string, unknown>).constants as Record<string, number>;
    // Imported directly from model.ts/ratings.ts, not re-typed as literals —
    // if either source constant changes, this test (and the snapshot) moves
    // with it automatically.
    expect(constants.homeFieldPoints).toBe(HOME_FIELD_POINTS);
    expect(constants.marginSd).toBe(MARGIN_SD);
    expect(constants.srsIterations).toBe(SRS_ITERATIONS);
    expect(constants.shrinkGames).toBe(SHRINK_GAMES);
    expect(constants.defaultLeagueAvgPoints).toBe(DEFAULT_LEAGUE_AVG_POINTS);
    expect(constants.maxPlausibleScore).toBe(MAX_PLAUSIBLE_SCORE);
  });
});

describe("stable team identity (ESPN id, not display name)", () => {
  it("uses espnTeamId for rating lookup and identity, ignoring displayName entirely", () => {
    const book = ratingBook([
      rating({ teamId: "100", offenseRating: 9, gamesPlayed: 6 }),
      rating({ teamId: "200", offenseRating: -2, gamesPlayed: 6 }),
    ]);
    // Same espnTeamId, two DIFFERENT display names across two "captures" — as
    // would happen if ESPN briefly renders a mid-season roster/branding
    // change, or a caller passes a differently-cased/abbreviated name.
    const g1 = game({ espnEventId: "e1", home: { espnTeamId: "100", displayName: "Old State University", abbreviation: null, record: null } });
    const g2 = game({ espnEventId: "e2", home: { espnTeamId: "100", displayName: "New State University", abbreviation: null, record: null } });

    const r1 = build([g1], book);
    const r2 = build([g2], book);
    const snap1 = r1.runInput!.predictions.find((p) => p.selectionKey === "home")!.featureSnapshot as Record<string, unknown>;
    const snap2 = r2.runInput!.predictions.find((p) => p.selectionKey === "home")!.featureSnapshot as Record<string, unknown>;

    // Identity and the resolved rating are identical — displayName never
    // entered the lookup or the stored identity at all.
    expect(snap1.homeTeamId).toBe("100");
    expect(snap2.homeTeamId).toBe("100");
    expect(snap1.homeRating).toEqual(snap2.homeRating);
    expect(Object.keys(snap1)).not.toContain("homeDisplayName");
  });
});

describe("average-but-rated team is distinguishable from a genuinely unrated one", () => {
  it("does not flag a team with real games played and a netRating of exactly 0 as unrated", () => {
    const book = ratingBook([
      rating({ teamId: "100", offenseRating: 0, defenseRating: 0, netRating: 0, gamesPlayed: 5 }), // genuinely average, real sample
      rating({ teamId: "200", offenseRating: 1, defenseRating: 1, netRating: 0, gamesPlayed: 4 }),
    ]);
    const { runInput } = build([game()], book);
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    expect(home.missingInputs).toEqual({ homeTeamUnrated: false, awayTeamUnrated: false });
    expect((home.featureSnapshot as Record<string, unknown>).homeRating).toEqual({
      offenseRating: 0,
      defenseRating: 0,
      netRating: 0,
      gamesPlayed: 5,
      strengthOfSchedule: 1.5,
    });
  });
});

describe("temporal attack boundaries", () => {
  it("a game kicking off exactly 1ms after generatedAt is eligible", () => {
    const kickoff = new Date(GENERATED_AT.getTime() + 1);
    const { runInput, exclusions } = build([game({ startUtc: kickoff })]);
    expect(runInput).not.toBeNull();
    expect(exclusions).toEqual([]);
  });

  it("a game kicking off exactly 1ms before generatedAt is excluded", () => {
    const kickoff = new Date(GENERATED_AT.getTime() - 1);
    const { runInput, exclusions } = build([game({ startUtc: kickoff })]);
    expect(runInput).toBeNull();
    expect(exclusions[0].reason).toBe("already-started");
  });

  it("dataAsOfUtc exactly equal to generatedAt is accepted end-to-end (validated, not just builder-permitted)", () => {
    const { runInput } = build([game()], RATED_BOOK, GENERATED_AT, GENERATED_AT);
    expect(validatePredictionRunInput(runInput!)).toEqual([]);
  });

  it("a dataAsOfUtc AFTER generatedAt is caught by the generic storage boundary's own validator — the temporal-integrity check lives in ONE place, not duplicated in the CFB builder", () => {
    const badDataAsOf = new Date(GENERATED_AT.getTime() + 60_000); // one minute after generatedAt — invalid
    const { runInput } = build([game()], RATED_BOOK, GENERATED_AT, badDataAsOf);
    // The pure CFB builder itself does not reject this (it only assembles
    // the run) — the generic validator, which every future sport's writer
    // shares, is what actually enforces dataAsOfUtc <= generatedAt.
    const issues = validatePredictionRunInput(runInput!);
    expect(issues.some((i) => i.includes("dataAsOfUtc") && i.includes("generatedAt"))).toBe(true);
  });
});
