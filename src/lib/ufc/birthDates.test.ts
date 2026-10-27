import { describe, expect, it } from "vitest";
import { normalizeFighterName, parseBirthDates } from "./birthDates";

describe("parseBirthDates", () => {
  const row = (name: string, dob: string) => ({ itemLabel: { value: name }, dob: { value: dob } });
  it("keys by normalized name and drops conflicting or unlabeled entries", () => {
    const m = parseBirthDates({
      results: {
        bindings: [
          row("Islam Makhachev", "1991-10-27T00:00:00Z"),
          row("José Aldo", "1986-09-09T00:00:00Z"),
          row("Mike Smith", "1980-01-01T00:00:00Z"),
          row("Mike Smith", "1992-05-05T00:00:00Z"),
          row("Q123456", "1990-01-01T00:00:00Z"),
        ],
      },
    });
    expect(m.get("islam makhachev")?.toISOString().slice(0, 10)).toBe("1991-10-27");
    expect(m.get(normalizeFighterName("Jose Aldo"))).toBeTruthy();
    expect(m.has("mike smith")).toBe(false);
    expect(m.size).toBe(2);
  });
});
