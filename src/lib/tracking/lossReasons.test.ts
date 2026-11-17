import { describe, expect, it } from "vitest";
import { lossReason, marginBucket, minutesVsProjection, reasonShares } from "./lossReasons";

const base = { side: "over", point: 20.5, actual: 14, projMinutes: 32, minutes: 31, margin: 4 };

describe("why a lean lost", () => {
  it("a hair first: within 1 of the line, whatever else happened", () => {
    expect(lossReason({ ...base, actual: 20, minutes: 18, margin: 30 })).toBe("lost by a hair");
  });

  it("a blowout that cut his minutes, before plain short minutes", () => {
    expect(lossReason({ ...base, minutes: 22, margin: -24 })).toBe("blowout");
    expect(lossReason({ ...base, minutes: 22, margin: 5 })).toBe("minutes short");
  });

  it("minutes long buries an under; short minutes don't explain an under's loss", () => {
    expect(lossReason({ ...base, side: "under", actual: 27, minutes: 40 })).toBe("minutes long");
    expect(lossReason({ ...base, side: "under", actual: 27, minutes: 25 })).toBe("projection miss");
  });

  it("minutes as projected: the miss was per minute; nothing to read: a projection miss", () => {
    expect(lossReason(base)).toBe("per-minute");
    expect(lossReason({ ...base, minutes: null })).toBe("projection miss");
  });

  it("buckets minutes and margin for every lean, and shares the reasons", () => {
    expect(minutesVsProjection(24, 31)).toBe("6+ minutes short of projected");
    expect(minutesVsProjection(30, 31)).toBe("Within 6 minutes of projected");
    expect(minutesVsProjection(null, 31)).toBeNull();
    expect(marginBucket(-21)).toBe("Blowout (20+)");
    expect(marginBucket(9)).toBe("Within 9 points");
    const shares = reasonShares([base, base, { ...base, actual: 20 }]);
    expect(shares.find((s) => s.reason === "per-minute")).toMatchObject({ n: 2 });
    expect(shares.reduce((a, s) => a + s.n, 0)).toBe(3);
  });
});
