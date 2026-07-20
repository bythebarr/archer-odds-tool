import { describe, it, expect } from "vitest";
import {
  BETTABLE_BOOK_KEYS,
  SHARP_BOOK_KEYS,
  ALLOWED_BOOK_KEYS,
  BOOK_INITIALS,
  BOOK_COLORS,
} from "./bookAllowlist";

/**
 * These lists decide where paying members are told to put money, so the
 * failures worth pinning are the ones that would send someone somewhere they
 * can't bet — or quietly drop a book we meant to shop.
 */

describe("book lists", () => {
  it("never offers a sharp book as somewhere to bet", () => {
    // Pinnacle prices well but most US retail bettors can't use it. Surfacing
    // it as "best book" would be advice nobody can act on.
    for (const sharp of SHARP_BOOK_KEYS) {
      expect(BETTABLE_BOOK_KEYS as readonly string[]).not.toContain(sharp);
    }
  });

  it("still STORES the sharp books — they anchor the de-vig consensus", () => {
    for (const sharp of SHARP_BOOK_KEYS) {
      expect(ALLOWED_BOOK_KEYS as readonly string[]).toContain(sharp);
    }
  });

  it("excludes the books judged unusable", () => {
    // bovada: offshore/unregulated. kalshi: incoherent quotes in the live feed
    // (both sides positive) that would manufacture fantasy EV.
    expect(ALLOWED_BOOK_KEYS as readonly string[]).not.toContain("bovada");
    expect(ALLOWED_BOOK_KEYS as readonly string[]).not.toContain("kalshi");
  });

  it("has no duplicates", () => {
    expect(new Set(ALLOWED_BOOK_KEYS).size).toBe(ALLOWED_BOOK_KEYS.length);
  });

  it("gives every stored book a label and colour, so none renders blank", () => {
    for (const key of ALLOWED_BOOK_KEYS) {
      expect(BOOK_INITIALS[key], `${key} has no initials`).toBeTruthy();
      expect(BOOK_COLORS[key], `${key} has no colour`).toBeTruthy();
    }
  });
});
