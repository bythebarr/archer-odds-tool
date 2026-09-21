import { describe, it, expect } from "vitest";
import {
  buildNflResearchSlate,
  buildNflResearchPredictionRun,
  computeNflGamePrediction,
  NFL_RESEARCH_H2H_MARKET_KEY,
} from "./predictionCapture";
import { NFL_RESEARCH_MODEL_KEY, NFL_RESEARCH_MODEL_VERSION, NFL_RESEARCH_LIFECYCLE } from "./modelIdentity";
import { buildNflEloAsOf } from "./eloAsOf";
import { DEFAULT_NFL_ELO } from "../elo";
import { MIN_GAMES_FOR_SIGNAL } from "../model";
import { validatePredictionRunInput } from "@/lib/predictions";
import type { NflScheduleGame } from "./espnSchedule";
import type { NflGame } from "../games";

const GENERATED_AT = new Date("2026-09-21T20:00:00.000Z");
const KICKOFF = new Date("2026-09-22T00:15:00.000Z"); // after GENERATED_AT — eligible
const ALREADY_STARTED = new Date("2026-09-21T19:00:00.000Z"); // before GENERATED_AT

function schedGame(overrides: Partial<NflScheduleGame> = {}): NflScheduleGame {
  return {
    espnEventId: "401872947",
    startUtc: KICKOFF,
    status: "scheduled",
    homeName: "Los Angeles Rams",
    awayName: "New York Giants",
    homeScore: null,
    awayScore: null,
    ...overrides,
  };
}

function nflGame(overrides: Partial<NflGame> = {}): NflGame {
  return {
    season: 2025,
    gameType: "REG",
    week: 1,
    date: new Date("2025-09-07T17:00:00.000Z"),
    away: "NYG",
    home: "LA",
    result: 7,
    spreadLine: null,
    totalLine: null,
    homeMoneyline: null,
    awayMoneyline: null,
    ...overrides,
  };
}

/** A rating book with real history for both Rams (LA) and Giants (NYG), well above the signal threshold. */
function ratedBook(asOf = GENERATED_AT) {
  const games: NflGame[] = [];
  for (let i = 0; i < MIN_GAMES_FOR_SIGNAL + 2; i++) {
    games.push(nflGame({ date: new Date(2025, 8, 1 + i), home: "LA", away: "NYG", result: 3 }));
  }
  return buildNflEloAsOf(games, asOf);
}

function build(schedule: NflScheduleGame[], eloBook = ratedBook(), generatedAt = GENERATED_AT) {
  return buildNflResearchSlate({ schedule, eloBook, generatedAt });
}

describe("temporal eligibility", () => {
  it("includes a scheduled game kicking off after generatedAt", () => {
    const slate = build([schedGame()]);
    expect(slate.eligible).toHaveLength(1);
    expect(slate.exclusions).toEqual([]);
  });

  it("excludes an already-started 'scheduled' game", () => {
    const slate = build([schedGame({ startUtc: ALREADY_STARTED })]);
    expect(slate.eligible).toHaveLength(0);
    expect(slate.exclusions).toEqual([{ espnEventId: "401872947", reason: "already-started" }]);
  });

  it("excludes a game kicking off exactly at generatedAt (not strictly after)", () => {
    const slate = build([schedGame({ startUtc: GENERATED_AT })]);
    expect(slate.exclusions[0].reason).toBe("already-started");
  });

  it.each([
    ["live", "status:live"],
    ["final", "status:final"],
    ["postponed", "status:postponed"],
    ["other", "status:other"],
  ] as const)("excludes a %s-status game with reason %s", (status, reason) => {
    const slate = build([schedGame({ status })]);
    expect(slate.eligible).toHaveLength(0);
    expect(slate.exclusions).toEqual([{ espnEventId: "401872947", reason }]);
  });
});

describe("team identity validation", () => {
  it("excludes a game with an unresolvable ESPN team name", () => {
    const slate = build([schedGame({ homeName: "Not A Real Team" })]);
    expect(slate.eligible).toHaveLength(0);
    expect(slate.exclusions[0].reason).toBe("unknown-espn-team");
    expect(slate.exclusions[0].detail).toContain("Not A Real Team");
  });

  it("excludes a game whose resolved nflverse code never appears in the fetched history (identity validation failure)", () => {
    // A book that only ever saw "LAR" (the wrong code) for the Rams — the
    // exact silent-mismatch scenario teamIdentity.ts exists to catch.
    const games: NflGame[] = [nflGame({ home: "LAR", away: "NYG" })];
    const badBook = buildNflEloAsOf(games, GENERATED_AT);
    const slate = build([schedGame()], badBook);
    expect(slate.eligible).toHaveLength(0);
    expect(slate.exclusions[0].reason).toBe("unresolved-nflverse-identity");
  });

  it("uses stable nflverse codes for identity/lookup, not raw ESPN display names", () => {
    const slate = build([schedGame()]);
    expect(slate.eligible[0].homeIdentity.nflverseCode).toBe("LA");
    expect(slate.eligible[0].awayIdentity.nflverseCode).toBe("NYG");
  });

  it("applies the Rams LA/LAR override consistently across rating lookup, games-played, display identity, and stored features — added by adversarial review", () => {
    // A book where LA and LAR would produce DIFFERENT numbers if the override
    // were applied inconsistently anywhere in the pipeline.
    const gamesUnderLA: NflGame[] = [];
    for (let i = 0; i < MIN_GAMES_FOR_SIGNAL + 3; i++) {
      gamesUnderLA.push(nflGame({ date: new Date(2025, 8, 1 + i), home: "LA", away: "NYG", result: 10 }));
    }
    const book = buildNflEloAsOf(gamesUnderLA, GENERATED_AT);
    const directRating = book.elo.rating("LA");
    const directGamesPlayed = book.elo.gamesPlayed("LA");

    const slate = build([schedGame()], book);
    const { homeIdentity, prediction } = slate.eligible[0];
    const { runInput } = buildNflResearchPredictionRun({ slate, eloOpts: book.opts, generatedAt: GENERATED_AT, dataAsOfUtc: GENERATED_AT });
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    const snap = home.featureSnapshot as Record<string, unknown>;

    // Current-schedule mapping: ESPN "Los Angeles Rams" -> display "LAR" -> lookup code "LA".
    expect(homeIdentity.abbreviation).toBe("LAR");
    expect(homeIdentity.nflverseCode).toBe("LA");
    // Games-played and displayed rating: same "LA"-keyed values as a direct lookup.
    expect(prediction.homeGamesPlayed).toBe(directGamesPlayed);
    expect(prediction.homeRating).toBe(directRating);
    // Stored prediction features: same code and same numbers, frozen.
    expect(snap.homeNflverseCode).toBe("LA");
    expect(snap.homeGamesPlayed).toBe(directGamesPlayed);
    expect(snap.homeRating).toBe(directRating);
    // Never the wrong code anywhere in the pipeline.
    expect(snap.homeNflverseCode).not.toBe("LAR");
  });
});

describe("complementary home/away probabilities", () => {
  it("home and away win probabilities sum to exactly 1", () => {
    const slate = build([schedGame()]);
    const { prediction } = slate.eligible[0];
    expect(prediction.homeWinProb + prediction.awayWinProb).toBe(1);
  });

  it("the stored run has exactly two predictions per game, complementary, same marketKey", () => {
    const slate = build([schedGame()]);
    const { runInput } = buildNflResearchPredictionRun({ slate, eloOpts: DEFAULT_NFL_ELO, generatedAt: GENERATED_AT, dataAsOfUtc: GENERATED_AT });
    expect(runInput!.predictions).toHaveLength(2);
    expect(runInput!.predictions.every((p) => p.marketKey === NFL_RESEARCH_H2H_MARKET_KEY)).toBe(true);
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    const away = runInput!.predictions.find((p) => p.selectionKey === "away")!;
    expect((home.probability ?? 0) + (away.probability ?? 0)).toBe(1);
  });
});

describe("expected-margin preservation", () => {
  it("stores the same expectedHomeMargin the shared prediction function computed, unmodified", () => {
    const slate = build([schedGame()]);
    const { prediction } = slate.eligible[0];
    const { runInput } = buildNflResearchPredictionRun({ slate, eloOpts: DEFAULT_NFL_ELO, generatedAt: GENERATED_AT, dataAsOfUtc: GENERATED_AT });
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    expect((home.projection as Record<string, unknown>).expectedHomeMargin).toBe(prediction.expectedHomeMargin);
  });
});

/**
 * Added by the adversarial review pass (point 5): proves home-field
 * advantage is applied exactly once in each of the two independent
 * computations that use it (win probability, expected margin) — not zero
 * times, not twice — by reconstructing each formula by hand from `NflElo`'s
 * own public `rating()` values and `DEFAULT_NFL_ELO.hfa`, and asserting an
 * exact match against the real methods' output.
 */
describe("home-field advantage is applied exactly once", () => {
  it("expectedHomeMargin matches (homeRating - awayRating + hfa) / pointsPerElo, HFA counted once", () => {
    const eloBook = ratedBook();
    const { prediction } = build([schedGame()], eloBook).eligible[0];
    const manualDiff = prediction.homeRating - prediction.awayRating + DEFAULT_NFL_ELO.hfa;
    expect(prediction.expectedHomeMargin).toBeCloseTo(manualDiff / DEFAULT_NFL_ELO.pointsPerElo, 10);

    // If HFA were applied zero times or twice, this would be off by exactly
    // hfa/pointsPerElo in one direction.
    const zeroHfaMargin = (prediction.homeRating - prediction.awayRating) / DEFAULT_NFL_ELO.pointsPerElo;
    const doubleHfaMargin = (prediction.homeRating - prediction.awayRating + 2 * DEFAULT_NFL_ELO.hfa) / DEFAULT_NFL_ELO.pointsPerElo;
    expect(prediction.expectedHomeMargin).not.toBeCloseTo(zeroHfaMargin, 5);
    expect(prediction.expectedHomeMargin).not.toBeCloseTo(doubleHfaMargin, 5);
  });

  it("homeWinProb matches the logistic curve over (homeRating - awayRating + hfa), HFA counted once", () => {
    const eloBook = ratedBook();
    const { prediction } = build([schedGame()], eloBook).eligible[0];
    const manualDiff = prediction.homeRating - prediction.awayRating + DEFAULT_NFL_ELO.hfa;
    const manualProb = 1 / (1 + Math.pow(10, -manualDiff / 400));
    expect(prediction.homeWinProb).toBeCloseTo(manualProb, 10);
  });
});

describe("live-page parity: shared computeNflGamePrediction, no duplicated math", () => {
  it("the slate's stored prediction is byte-identical to calling computeNflGamePrediction directly on the same Elo instance", () => {
    const eloBook = ratedBook();
    const direct = computeNflGamePrediction(eloBook.elo, "LA", "NYG");
    const slate = build([schedGame()], eloBook);
    expect(slate.eligible[0].prediction).toEqual(direct);
  });
});

describe("missing-data / low-history warnings", () => {
  it("flags a team below MIN_GAMES_FOR_SIGNAL as low-history, not unrated", () => {
    const games: NflGame[] = [nflGame({ home: "LA", away: "NYG", result: 3 })]; // only 1 game each
    const thinBook = buildNflEloAsOf(games, GENERATED_AT);
    const slate = build([schedGame()], thinBook);
    const { prediction } = slate.eligible[0];
    expect(prediction.homeUnrated).toBe(false);
    expect(prediction.homeLowHistory).toBe(true);
    expect(prediction.warnings.some((w) => w.includes("tracked game"))).toBe(true);
  });

  it("flags a team with zero games as unrated, not merely low-history", () => {
    // Calls computeNflGamePrediction directly rather than going through
    // buildNflResearchSlate: after identity validation, a team can only
    // reach the prediction step if its code is in `teamsSeen`, which by
    // construction (teamsSeen is populated from replayed games) guarantees
    // gamesPlayed >= 1 — so "unrated" is structurally unreachable through
    // the full pipeline for any team that passes identity validation. The
    // branch itself is still real and correct (defense-in-depth, and
    // reachable if this function is ever called from elsewhere), so it's
    // tested directly here rather than deleted.
    const emptyElo = buildNflEloAsOf([], GENERATED_AT).elo;
    const prediction = computeNflGamePrediction(emptyElo, "LA", "NYG");
    expect(prediction.homeUnrated).toBe(true);
    expect(prediction.awayUnrated).toBe(true);
    expect(prediction.warnings.some((w) => w.includes("no prior games"))).toBe(true);
  });

  it("does not warn about a team with real games at or above the signal threshold", () => {
    const slate = build([schedGame()]); // ratedBook has MIN_GAMES_FOR_SIGNAL + 2 games each
    expect(slate.eligible[0].prediction.warnings).toEqual([]);
  });

  it("distinguishes a genuinely average, well-sampled team from an unrated one (rating 0 is not itself a missing-data signal)", () => {
    // Build a symmetric history so both teams' ratings converge near 0 while games played stays high.
    const games: NflGame[] = [];
    for (let i = 0; i < MIN_GAMES_FOR_SIGNAL + 4; i++) {
      games.push(nflGame({ date: new Date(2025, 8, 1 + i), home: i % 2 === 0 ? "LA" : "NYG", away: i % 2 === 0 ? "NYG" : "LA", result: 0 }));
    }
    const evenBook = buildNflEloAsOf(games, GENERATED_AT);
    const slate = build([schedGame()], evenBook);
    const { prediction } = slate.eligible[0];
    expect(prediction.homeUnrated).toBe(false);
    expect(prediction.homeGamesPlayed).toBeGreaterThanOrEqual(MIN_GAMES_FOR_SIGNAL);
  });
});

describe("model lifecycle stays experimental", () => {
  it("stamps the fixed model identity and experimental lifecycle onto every run", () => {
    const slate = build([schedGame()]);
    const { runInput } = buildNflResearchPredictionRun({ slate, eloOpts: DEFAULT_NFL_ELO, generatedAt: GENERATED_AT, dataAsOfUtc: GENERATED_AT });
    expect(runInput!.modelKey).toBe(NFL_RESEARCH_MODEL_KEY);
    expect(runInput!.modelVersion).toBe(NFL_RESEARCH_MODEL_VERSION);
    expect(runInput!.lifecycle).toBe(NFL_RESEARCH_LIFECYCLE);
    expect(runInput!.lifecycle).toBe("experimental");
    expect(runInput!.lifecycle).not.toBe("validated");
    expect(runInput!.lifecycle).not.toBe("production");
  });
});

describe("prediction snapshot payload fidelity", () => {
  it("freezes every required field: identity, ratings, cutoff, constants/options", () => {
    const eloBook = ratedBook();
    const slate = build([schedGame()], eloBook);
    const { runInput } = buildNflResearchPredictionRun({ slate, eloOpts: eloBook.opts, generatedAt: GENERATED_AT, dataAsOfUtc: GENERATED_AT });
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    const snap = home.featureSnapshot as Record<string, unknown>;

    expect(snap.espnEventId).toBe("401872947");
    expect(snap.scheduledStartUtc).toBe(KICKOFF.toISOString());
    expect(snap.homeNflverseCode).toBe("LA");
    expect(snap.awayNflverseCode).toBe("NYG");
    expect(typeof snap.homeRating).toBe("number");
    expect(typeof snap.awayRating).toBe("number");
    expect(snap.homeGamesPlayed).toBe(MIN_GAMES_FOR_SIGNAL + 2);
    expect(snap.dataAsOfUtc).toBe(GENERATED_AT.toISOString());
    expect(snap.eloOpts).toEqual(DEFAULT_NFL_ELO);
  });

  it("is valid per the generic storage boundary's own validator", () => {
    const slate = build([schedGame()]);
    const { runInput } = buildNflResearchPredictionRun({ slate, eloOpts: DEFAULT_NFL_ELO, generatedAt: GENERATED_AT, dataAsOfUtc: GENERATED_AT });
    expect(validatePredictionRunInput(runInput!)).toEqual([]);
  });

  it("never sets marketSnapshot (no server-side market exists for this pass)", () => {
    const slate = build([schedGame()]);
    const { runInput } = buildNflResearchPredictionRun({ slate, eloOpts: DEFAULT_NFL_ELO, generatedAt: GENERATED_AT, dataAsOfUtc: GENERATED_AT });
    for (const p of runInput!.predictions) expect(p.marketSnapshot).toBeUndefined();
  });
});

describe("no fabricated totals or spread-cover probability", () => {
  it("the projection payload contains only expectedHomeMargin — nothing spread/total-shaped", () => {
    const slate = build([schedGame()]);
    const { runInput } = buildNflResearchPredictionRun({ slate, eloOpts: DEFAULT_NFL_ELO, generatedAt: GENERATED_AT, dataAsOfUtc: GENERATED_AT });
    const home = runInput!.predictions.find((p) => p.selectionKey === "home")!;
    const proj = home.projection as Record<string, unknown>;
    expect(Object.keys(proj)).toEqual(["expectedHomeMargin"]);
    expect(proj.homeCoverProb).toBeUndefined();
    expect(proj.overProb).toBeUndefined();
    expect(proj.totalProb).toBeUndefined();
  });
});

describe("empty slate / all excluded", () => {
  it("returns a null runInput for an empty schedule", () => {
    const slate = build([]);
    const { runInput } = buildNflResearchPredictionRun({ slate, eloOpts: DEFAULT_NFL_ELO, generatedAt: GENERATED_AT, dataAsOfUtc: GENERATED_AT });
    expect(runInput).toBeNull();
  });

  it("returns a null runInput when every game is excluded", () => {
    const slate = build([schedGame({ status: "final" }), schedGame({ espnEventId: "e2", startUtc: ALREADY_STARTED })]);
    const { runInput } = buildNflResearchPredictionRun({ slate, eloOpts: DEFAULT_NFL_ELO, generatedAt: GENERATED_AT, dataAsOfUtc: GENERATED_AT });
    expect(runInput).toBeNull();
    expect(slate.eligible).toHaveLength(0);
  });
});
