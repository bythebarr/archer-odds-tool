import { describe, expect, it } from "vitest";
import { edgeTone, formatEdge } from "./EdgeLineRow";

describe("edge row display", () => {
  it("formats the edge with its sign, and a dash when there's none", () => {
    expect(formatEdge(0.042)).toBe("+4.2%");
    expect(formatEdge(-0.013)).toBe("−1.3%");
    expect(formatEdge(null)).toBe("—");
  });

  it("colours by sign and size, and greys every frozen edge", () => {
    expect(edgeTone(0.06, false)).toContain("emerald-600");
    expect(edgeTone(0.03, false)).toContain("emerald-700");
    expect(edgeTone(0.01, false)).toBe("text-foreground");
    expect(edgeTone(-0.02, false)).toBe("text-muted-foreground");
    expect(edgeTone(0.06, true)).toBe("text-muted-foreground/70");
    expect(edgeTone(null, false)).toBe("text-muted-foreground/70");
  });
});
