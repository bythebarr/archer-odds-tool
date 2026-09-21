import { describe, it, expect } from "vitest";
import { parseNflSchedule } from "./espnSchedule";

/**
 * Parses a captured-shape ESPN NFL scoreboard payload — no network call.
 * Field/status shapes match a real response fetched live 2026-09-21 (see
 * this file's sibling `espnSchedule.ts` docstring).
 */

function competitor(homeAway: "home" | "away", displayName: string, score: string | number = "0") {
  return { homeAway, score, team: { displayName } };
}

interface RawCompetitor {
  homeAway: string;
  score: string | number;
  team: { displayName?: string };
}

function event(overrides: {
  id?: string;
  date?: string;
  statusName?: string;
  completed?: boolean;
  competitors?: RawCompetitor[];
}) {
  return {
    id: overrides.id ?? "401872947",
    date: overrides.date ?? "2026-09-22T00:15Z",
    competitions: [
      {
        status: { type: { name: overrides.statusName ?? "STATUS_SCHEDULED", completed: overrides.completed ?? false } },
        competitors: overrides.competitors ?? [competitor("home", "Los Angeles Rams"), competitor("away", "New York Giants")],
      },
    ],
  };
}

describe("parseNflSchedule", () => {
  it("parses a scheduled game with pregame zero scores as null", () => {
    const games = parseNflSchedule({ events: [event({})] });
    expect(games).toHaveLength(1);
    expect(games[0].status).toBe("scheduled");
    expect(games[0].homeName).toBe("Los Angeles Rams");
    expect(games[0].awayName).toBe("New York Giants");
    expect(games[0].homeScore).toBeNull();
    expect(games[0].awayScore).toBeNull();
  });

  it("parses a final game with real scores", () => {
    const games = parseNflSchedule({
      events: [
        event({
          statusName: "STATUS_FINAL",
          completed: true,
          competitors: [competitor("home", "Buffalo Bills", 41), competitor("away", "Detroit Lions", 31)],
        }),
      ],
    });
    expect(games[0].status).toBe("final");
    expect(games[0].homeScore).toBe(41);
    expect(games[0].awayScore).toBe(31);
  });

  it.each([
    ["STATUS_IN_PROGRESS", "live"],
    ["STATUS_HALFTIME", "live"],
    ["STATUS_END_PERIOD", "live"],
    ["STATUS_DELAYED", "live"],
    ["STATUS_POSTPONED", "postponed"],
    ["STATUS_CANCELED", "postponed"],
    ["STATUS_SOMETHING_NEW", "other"],
  ] as const)("maps ESPN status %s to %s", (statusName, expected) => {
    const games = parseNflSchedule({ events: [event({ statusName })] });
    expect(games[0].status).toBe(expected);
  });

  it("completed:true always wins regardless of status name", () => {
    const games = parseNflSchedule({ events: [event({ statusName: "STATUS_IN_PROGRESS", completed: true })] });
    expect(games[0].status).toBe("final");
  });

  it("drops an event with a missing id", () => {
    const raw = event({});
    const noId = { ...raw, id: undefined };
    expect(parseNflSchedule({ events: [noId] })).toEqual([]);
  });

  it("drops an event with fewer than two competitors", () => {
    const raw = event({ competitors: [competitor("home", "Buffalo Bills")] });
    expect(parseNflSchedule({ events: [raw] })).toEqual([]);
  });

  it("drops an event with a missing team display name", () => {
    const raw = event({ competitors: [{ homeAway: "home", score: "0", team: {} }, competitor("away", "New York Giants")] });
    expect(parseNflSchedule({ events: [raw] })).toEqual([]);
  });

  it("drops a completed event with a non-numeric score", () => {
    const raw = event({
      statusName: "STATUS_FINAL",
      completed: true,
      competitors: [competitor("home", "Buffalo Bills", "N/A"), competitor("away", "Detroit Lions", 31)],
    });
    expect(parseNflSchedule({ events: [raw] })).toEqual([]);
  });

  it("drops an event with an unparseable date", () => {
    const raw = event({ date: "not-a-date" });
    expect(parseNflSchedule({ events: [raw] })).toEqual([]);
  });

  it("handles a null/undefined payload without throwing", () => {
    expect(parseNflSchedule(null)).toEqual([]);
    expect(parseNflSchedule(undefined)).toEqual([]);
    expect(parseNflSchedule({})).toEqual([]);
  });
});
