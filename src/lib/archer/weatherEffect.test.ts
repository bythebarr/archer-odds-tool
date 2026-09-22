import { describe, expect, it } from "vitest";
import { weatherRunsShift, type GameWeatherConditions } from "./weatherEffect";

const OPEN_ROOF = "Open";

/** Everything neutral except the one field a test overrides. */
function conditions(overrides: Partial<GameWeatherConditions> = {}): GameWeatherConditions {
  return {
    temperatureF: 70,
    windMph: 0,
    windFromDeg: 0,
    venueAzimuthDeg: 0,
    roofType: OPEN_ROOF,
    ...overrides,
  };
}

describe("weatherRunsShift — wind direction (worked examples)", () => {
  // Park azimuth 0° = home plate faces due north (center field is north of home plate).

  it("raises the shift for wind blowing straight OUT to center", () => {
    // Wind blowing from south to north (toward center) is, by meteorological
    // convention, "coming FROM the south" — windFromDeg 180.
    const shift = weatherRunsShift(conditions({ venueAzimuthDeg: 0, windFromDeg: 180, windMph: 15 }));
    expect(shift).toBeGreaterThan(0);
  });

  it("lowers the shift for wind blowing straight IN from center", () => {
    // Wind blowing from north to south (toward home plate) is coming FROM
    // the north — windFromDeg 0.
    const shift = weatherRunsShift(conditions({ venueAzimuthDeg: 0, windFromDeg: 0, windMph: 15 }));
    expect(shift).toBeLessThan(0);
  });

  it("is ~zero for a pure crosswind", () => {
    // Wind blowing from west to east (perpendicular to a north-facing park)
    // is coming FROM the west — windFromDeg 270.
    const shift = weatherRunsShift(conditions({ venueAzimuthDeg: 0, windFromDeg: 270, windMph: 15 }));
    expect(shift).toBeCloseTo(0, 6);
  });

  it("holds for a non-zero park azimuth too (not just due-north parks)", () => {
    // Park azimuth 90° = home plate faces east. Wind blowing straight out
    // (west to east) is coming FROM the west — windFromDeg 270.
    const outShift = weatherRunsShift(conditions({ venueAzimuthDeg: 90, windFromDeg: 270, windMph: 15 }));
    // Wind blowing straight in (east to west) is coming FROM the east — windFromDeg 90.
    const inShift = weatherRunsShift(conditions({ venueAzimuthDeg: 90, windFromDeg: 90, windMph: 15 }));
    expect(outShift).toBeGreaterThan(0);
    expect(inShift).toBeLessThan(0);
  });

  it("scales with wind speed in the same direction", () => {
    const light = weatherRunsShift(conditions({ venueAzimuthDeg: 0, windFromDeg: 180, windMph: 5 }));
    const strong = weatherRunsShift(conditions({ venueAzimuthDeg: 0, windFromDeg: 180, windMph: 15 }));
    expect(strong).toBeGreaterThan(light);
    expect(light).toBeGreaterThan(0);
  });
});

describe("weatherRunsShift — temperature", () => {
  it("raises the shift on a hot day", () => {
    expect(weatherRunsShift(conditions({ temperatureF: 95 }))).toBeGreaterThan(0);
  });

  it("lowers the shift on a cold day", () => {
    expect(weatherRunsShift(conditions({ temperatureF: 40 }))).toBeLessThan(0);
  });

  it("is zero at the neutral baseline temperature with no wind", () => {
    expect(weatherRunsShift(conditions({ temperatureF: 70 }))).toBeCloseTo(0, 10);
  });
});

describe("weatherRunsShift — caps and gating", () => {
  it("caps an extreme temperature reading instead of scaling unbounded", () => {
    const extreme = weatherRunsShift(conditions({ temperatureF: 150 }));
    const veryHot = weatherRunsShift(conditions({ temperatureF: 130 }));
    expect(extreme).toBeCloseTo(veryHot, 6); // both past the cap
  });

  it("caps an extreme wind reading instead of scaling unbounded", () => {
    const extreme = weatherRunsShift(conditions({ venueAzimuthDeg: 0, windFromDeg: 180, windMph: 100 }));
    const strong = weatherRunsShift(conditions({ venueAzimuthDeg: 0, windFromDeg: 180, windMph: 50 }));
    expect(extreme).toBeCloseTo(strong, 6); // both past the cap
  });

  it("is always zero when the roof isn't reported Open, regardless of conditions", () => {
    const retractable = weatherRunsShift(
      conditions({ roofType: "Retractable", temperatureF: 95, windFromDeg: 180, windMph: 20, venueAzimuthDeg: 0 })
    );
    expect(retractable).toBe(0);
  });

  it("is zero for a null conditions object", () => {
    expect(weatherRunsShift(null)).toBe(0);
  });

  it("applies only the available component when some fields are missing", () => {
    const tempOnly = weatherRunsShift(conditions({ windMph: null, windFromDeg: null, venueAzimuthDeg: null }));
    expect(tempOnly).toBeCloseTo(0, 10); // temp is at neutral in the fixture, so still ~0 — just confirms no crash/NaN
    expect(Number.isNaN(tempOnly)).toBe(false);
  });
});
