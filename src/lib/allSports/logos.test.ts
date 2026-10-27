import { describe, expect, it } from "vitest";
import { pickWikiImage } from "./logos";

describe("pickWikiImage", () => {
  it("takes a club's crest when the page is that sport's club", () => {
    const pages = [
      { title: "Helsingin Jalkapalloklubi", index: 1, description: "Association football club in Helsinki, Finland", thumbnail: { source: "hjk.png" } },
      { title: "HJK", index: 2, description: "Topics referred to by the same term" },
    ];
    expect(pickWikiImage(pages, "soccer", "HJK Helsinki")).toBe("hjk.png");
  });

  it("skips pages about something else", () => {
    const pages = [{ title: "HD Hyundai", index: 1, description: "South Korean conglomerate", thumbnail: { source: "office.jpg" } }];
    expect(pickWikiImage(pages, "soccer", "Ulsan HD")).toBeNull();
  });

  it("never swaps one player for another", () => {
    const pages = [
      { title: "Luke Humphries", index: 1, description: "English darts player (born 1995)", thumbnail: { source: "humphries.jpg" } },
      { title: "Luke Littler", index: 2, description: "English darts player (born 2007)", thumbnail: { source: "littler.jpg" } },
    ];
    expect(pickWikiImage(pages, "darts", "Luke Littler")).toBe("littler.jpg");
  });
});
