import { describe, it, expect } from "vitest";
import { TEACHABLE, dayIndex, tipForDate, renderTip } from "./postTips";

/**
 * The rotation has to be deterministic — a retry after a failed post must not
 * skip or duplicate a lesson — and it must eventually cover everything rather
 * than looping over a favourite few.
 */

describe("tip rotation", () => {
  it("is stable: the same date always yields the same tip", () => {
    expect(tipForDate("2026-07-20")).toBe(tipForDate("2026-07-20"));
  });

  it("advances day to day", () => {
    expect(tipForDate("2026-07-20")).not.toBe(tipForDate("2026-07-21"));
  });

  it("covers every teachable entry across one full cycle", () => {
    const seen = new Set<string>();
    const start = dayIndex("2026-07-20");
    for (let i = 0; i < TEACHABLE.length; i++) {
      const d = new Date((start + i) * 86_400_000).toISOString().slice(0, 10);
      seen.add(tipForDate(d)!.id);
    }
    expect(seen.size).toBe(TEACHABLE.length);
  });

  it("excludes app-navigation terms, which mean nothing in Discord", () => {
    expect(TEACHABLE.every((e) => e.category !== "getting-around")).toBe(true);
    expect(TEACHABLE.length).toBeGreaterThan(0);
  });
});

describe("renderTip", () => {
  it("leads with the term and carries the compliance footer", () => {
    const embed = renderTip(TEACHABLE[0]);
    expect(embed.title).toContain(TEACHABLE[0].term);
    expect(embed.description).toContain(TEACHABLE[0].short);
    expect(embed.footer.text).toContain("21+");
  });

  it("renders an entry with no long-form body without a dangling gap", () => {
    const embed = renderTip({ id: "x", term: "Juice", short: "The book's cut.", category: "odds" });
    expect(embed.description).toContain("The book's cut.");
    expect(embed.description).not.toContain("\n\n\n");
  });
});
