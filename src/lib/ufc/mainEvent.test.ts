import { describe, it, expect } from "vitest";
import { identifyMainEventBoutId } from "./mainEvent";

const bout = (id: string, redName: string, blueName: string, boutOrder: number | null = null) => ({
  id,
  boutOrder,
  redName,
  blueName,
});

describe("identifyMainEventBoutId", () => {
  it("uses the lowest boutOrder when the card was ingested with it", () => {
    const bouts = [
      bout("comain", "A Fighter", "B Fighter", 1002),
      bout("main", "C Fighter", "D Fighter", 1001),
      bout("prelim", "E Fighter", "F Fighter", 2001),
    ];
    expect(identifyMainEventBoutId(bouts, "UFC 999: Whoever vs. Someone")).toBe("main");
  });

  it("handles a main event numbered 1002 (Fight Nights sometimes start there)", () => {
    const bouts = [bout("main", "A", "B", 1002), bout("co", "C", "D", 1003)];
    expect(identifyMainEventBoutId(bouts, null)).toBe("main");
  });

  it("falls back to the event title when no bout has a boutOrder (historical gap)", () => {
    const bouts = [
      bout("prelim", "Random Prelim", "Other Guy"),
      bout("main", "Ilia Topuria", "Max Holloway"),
      bout("comain", "Some Contender", "Another Contender"),
    ];
    // Non-title, early KO, no boutOrder — only the title saves it.
    expect(identifyMainEventBoutId(bouts, "UFC 308: Topuria vs. Holloway")).toBe("main");
  });

  it("matches through diacritics in fighter names", () => {
    const bouts = [bout("main", "Alex Pereira", "Jiří Procházka"), bout("p", "X Guy", "Y Guy")];
    expect(identifyMainEventBoutId(bouts, "UFC 303: Pereira vs. Prochazka 2")).toBe("main");
  });

  it("matches family-name-first (Asian) name order", () => {
    const bouts = [bout("main", "Song Yadong", "Henry Cejudo"), bout("p", "X Guy", "Y Guy")];
    expect(identifyMainEventBoutId(bouts, "UFC Fight Night: Cejudo vs. Song")).toBe("main");
  });

  it("returns null for a slogan/nickname title with no boutOrder (backstop territory)", () => {
    const bouts = [bout("a", "Some Fighter", "Another"), bout("b", "Third", "Fourth")];
    expect(identifyMainEventBoutId(bouts, "UFC 101: Declaration")).toBeNull();
  });

  it("returns null on an empty card", () => {
    expect(identifyMainEventBoutId([], "UFC 1: The Beginning")).toBeNull();
  });
});
