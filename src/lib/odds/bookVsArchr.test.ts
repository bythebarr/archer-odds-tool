import { describe, expect, it } from "vitest";
import { fairAmericanOf, formatArchrLine, lineTone, staleDate } from "./bookVsArchr";

describe("bookVsArchr", () => {
  it("prices ARCHR's chance as a fair American price", () => {
    expect(fairAmericanOf(0.5)).toBe(100);
    expect(fairAmericanOf(0.75)).toBe(-300);
    expect(fairAmericanOf(0.25)).toBe(300);
    expect(fairAmericanOf(null)).toBeNull();
    expect(fairAmericanOf(1)).toBeNull();
  });

  it("formats ARCHR's line in the book's format", () => {
    expect(formatArchrLine({ kind: "price", american: -350 })).toBe("-350");
    expect(formatArchrLine({ kind: "spread", point: 5.24 })).toBe("+5.2");
    expect(formatArchrLine({ kind: "spread", point: -3.96 })).toBe("−4");
    expect(formatArchrLine({ kind: "total", point: 228.14, side: "over" })).toBe("228.1");
  });

  it("moneyline/prop: value when the book pays more than ARCHR's fair price", () => {
    expect(lineTone({ priceAmerican: -337, point: null }, { kind: "price", american: -350 })).toBe("value");
    expect(lineTone({ priceAmerican: -360, point: null }, { kind: "price", american: -350 })).toBe("worse");
    expect(lineTone({ priceAmerican: 150, point: null }, { kind: "price", american: 150 })).toBe("even");
  });

  it("spread: value when the book gives more points than ARCHR's spread", () => {
    expect(lineTone({ priceAmerican: -110, point: 3.5 }, { kind: "spread", point: 5.2 })).toBe("worse");
    expect(lineTone({ priceAmerican: -110, point: -3.5 }, { kind: "spread", point: -5.2 })).toBe("value");
  });

  it("total: Over is value below ARCHR's total, Under above it", () => {
    expect(lineTone({ priceAmerican: -110, point: 224.5 }, { kind: "total", point: 228.1, side: "over" })).toBe("value");
    expect(lineTone({ priceAmerican: -110, point: 224.5 }, { kind: "total", point: 228.1, side: "under" })).toBe("worse");
  });

  it("no tone without both lines", () => {
    expect(lineTone(null, { kind: "price", american: 100 })).toBeNull();
    expect(lineTone({ priceAmerican: 100, point: null }, null)).toBeNull();
    expect(lineTone({ priceAmerican: 100, point: null }, { kind: "spread", point: 1 })).toBeNull();
  });

  it("dates a price only when its own poll is stale", () => {
    const now = new Date("2026-11-13T15:00:00Z");
    expect(staleDate("2026-11-13T12:00:00Z", now)).toBeNull();
    expect(staleDate("2026-11-01T22:00:00Z", now)).toBe("Nov 1");
    expect(staleDate(null, now)).toBeNull();
  });
});
