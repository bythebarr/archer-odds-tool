import { describe, expect, it } from "vitest";
import { pickHeadshot } from "./headshots";

describe("pickHeadshot", () => {
  it("takes the photo only for a page about a player of the sport", () => {
    expect(pickHeadshot({ description: "Italian tennis player (born 2001)", thumbnail: { source: "https://x/s.jpg" } }, /tennis/i)).toBe("https://x/s.jpg");
    expect(pickHeadshot({ description: "American footballer", thumbnail: { source: "https://x/f.jpg" } }, /tennis/i)).toBeNull();
    expect(pickHeadshot({ description: "Topics referred to by the same term" }, /tennis/i)).toBeNull();
    expect(pickHeadshot(null, /tennis/i)).toBeNull();
  });
});
