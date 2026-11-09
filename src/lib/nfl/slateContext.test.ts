import { describe, expect, it } from "vitest";
import { nflProjectionContext } from "./slateContext";
import type { NflPropsSlate, NflSlatePlayer } from "@/lib/queries/nflProps";

const defense = { season: 2026, fromLastSeason: false, teams: {} };
const player = {
  id: "p1",
  name: "Back",
  headshotUrl: "",
  position: "RB",
  gameId: "g1",
  team: { abbreviation: "AAA", name: "A Team", logoUrl: "" },
  opponent: { abbreviation: "BBB", name: "B Team", logoUrl: "" },
  venue: "home",
  injury: null,
} as unknown as NflSlatePlayer;

const slate = (over: Partial<NflPropsSlate>): NflPropsSlate =>
  ({
    season: 2026,
    games: [],
    players: {},
    logs: {},
    usage: {},
    props: [],
    defense,
    absences: {},
    absenceImpacts: { AAA: [{ name: "Our QB", status: "out", impact: 3 }], BBB: [{ name: "Their RB", status: "out", impact: 0.6 }] },
    lines: { g1: { homeSpread: -3, total: 44 } },
    modelLines: {},
    teamPoints: { AAA: 24 },
    modelWeights: {},
    calibrationFactors: {},
    blendVerdicts: {},
    teams: {},
    lastPolledAt: null,
    ...over,
  }) as NflPropsSlate;

describe("nflProjectionContext", () => {
  it("reads the model's own lines first, with no second absence adjustment", () => {
    const ctx = nflProjectionContext(slate({ modelLines: { g1: { homeSpread: -6, total: 41 } } }), player);
    expect(ctx.lines).toEqual({ homeSpread: -6, total: 41 });
    // The model totals already carry both teams' absences (adjustExpected).
    expect(ctx.ownAbsenceImpact).toBe(0);
    expect(ctx.opponentAbsenceImpact).toBe(0);
  });

  it("falls back to the market lines, absence re-read intact, when the model can't price the game", () => {
    const ctx = nflProjectionContext(slate({}), player);
    expect(ctx.lines).toEqual({ homeSpread: -3, total: 44 });
    expect(ctx.ownAbsenceImpact).toBe(3);
    expect(ctx.opponentAbsenceImpact).toBe(0.6);
  });
});
