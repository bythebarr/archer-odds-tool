import { describe, expect, it } from "vitest";
import { MAX_PRECIP_DRAG, MAX_WIND_DRAG, nflWeatherFactor, type NflGameWeather } from "./weather";

const calm: NflGameWeather = { windMph: 4, precipProb: 0, temperatureF: 55 };
const windy: NflGameWeather = { windMph: 30, precipProb: null, temperatureF: 40 };
const storm: NflGameWeather = { windMph: 8, precipProb: 1, temperatureF: 48 };

describe("nflWeatherFactor", () => {
  it("is neutral without a weather row (domes, unsynced games)", () => {
    expect(nflWeatherFactor(null, "passYards")).toBe(1);
    expect(nflWeatherFactor(undefined, "kickingPoints")).toBe(1);
  });

  it("is neutral in calm weather", () => {
    expect(nflWeatherFactor(calm, "passYards")).toBe(1);
    expect(nflWeatherFactor(calm, "fieldGoals")).toBe(1);
  });

  it("drags passing and kicking at full wind, kicking hardest", () => {
    expect(nflWeatherFactor(windy, "passYards")).toBeCloseTo(1 - MAX_WIND_DRAG, 6);
    expect(nflWeatherFactor(windy, "kickingPoints")).toBeCloseTo(1 - MAX_WIND_DRAG * 1.15, 6);
    expect(nflWeatherFactor(windy, "receptions")).toBeGreaterThan(nflWeatherFactor(windy, "passYards"));
  });

  it("leaves rushing and defensive stats alone in wind", () => {
    expect(nflWeatherFactor(windy, "rushYards")).toBe(1);
    expect(nflWeatherFactor(windy, "rushAttempts")).toBe(1);
    expect(nflWeatherFactor(windy, "soloTackles")).toBe(1);
  });

  it("scales precip drag with probability and treats null as no signal", () => {
    expect(nflWeatherFactor(storm, "passYards")).toBeCloseTo(1 - MAX_PRECIP_DRAG, 6);
    expect(nflWeatherFactor({ ...storm, precipProb: 0.5 }, "passYards")).toBeCloseTo(1 - MAX_PRECIP_DRAG / 2, 6);
    expect(nflWeatherFactor({ windMph: 8, precipProb: null, temperatureF: 48 }, "passYards")).toBe(1);
  });

  it("ramps wind in gradually and never breaches the floor", () => {
    const mid = nflWeatherFactor({ windMph: 17.5, precipProb: null, temperatureF: 40 }, "passYards");
    expect(mid).toBeCloseTo(1 - MAX_WIND_DRAG / 2, 6);
    const extreme = nflWeatherFactor({ windMph: 60, precipProb: 1, temperatureF: 20 }, "kickingPoints");
    expect(extreme).toBeGreaterThanOrEqual(0.78);
  });
});
