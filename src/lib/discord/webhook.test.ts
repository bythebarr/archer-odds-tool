import { describe, it, expect, vi, afterEach } from "vitest";
import { batchEmbeds, embedChars, postWebhook, postEmbeds, MAX_CHARS_PER_MESSAGE } from "./webhook";

/**
 * Discord rejects a message over 10 embeds or 6,000 characters across its
 * embeds, and the slate routinely runs past both. batchEmbeds is what keeps
 * those posts from failing with a 400.
 */
const embed = (chars: number) => ({ title: "t", description: "x".repeat(chars - 1) });

describe("embedChars", () => {
  it("counts title, description, footer, author name and fields", () => {
    expect(
      embedChars({
        title: "ab",
        description: "cde",
        footer: { text: "f" },
        author: { name: "gh", url: "not counted" },
        fields: [{ name: "i", value: "jk" }],
        color: 123,
      })
    ).toBe(11);
  });
});

describe("batchEmbeds", () => {
  it("keeps a small post in one message", () => {
    expect(batchEmbeds([embed(100), embed(100)])).toHaveLength(1);
  });

  it("splits before the 6,000-character limit, in order", () => {
    const es = [embed(4000), embed(4000), embed(1500)];
    const batches = batchEmbeds(es);
    expect(batches).toEqual([[es[0]], [es[1], es[2]]]);
    for (const b of batches) expect(b.reduce((n, e) => n + embedChars(e), 0)).toBeLessThanOrEqual(MAX_CHARS_PER_MESSAGE);
  });

  it("splits past 10 embeds", () => {
    const batches = batchEmbeds(Array.from({ length: 23 }, () => embed(10)));
    expect(batches.map((b) => b.length)).toEqual([10, 10, 3]);
  });

  it("drops nothing", () => {
    const es = Array.from({ length: 17 }, (_, i) => embed(500 + i * 200));
    expect(batchEmbeds(es).flat()).toEqual(es);
  });
});

describe("postWebhook", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits out a 429 and retries once", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ retry_after: 1.5 }), { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const done = postWebhook("https://discord.test/hook", { content: "hi" });
    await vi.advanceTimersByTimeAsync(1500);
    await done;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on a second 429", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => new Response(JSON.stringify({ retry_after: 0.1 }), { status: 429 }))
    );
    const done = expect(postWebhook("https://discord.test/hook", {})).rejects.toThrow(/429/);
    await vi.advanceTimersByTimeAsync(100);
    await done;
  });

  it("throws on any other failure without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad embed", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(postWebhook("https://discord.test/hook", {})).rejects.toThrow(/400.*bad embed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("postEmbeds", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts one message per batch, content on the first only", async () => {
    const bodies: Array<{ content?: string; embeds: unknown[]; username: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(null, { status: 204 });
      })
    );
    await postEmbeds("https://discord.test/hook", [embed(4000), embed(4000)], "Good morning");
    expect(bodies.map((b) => b.embeds.length)).toEqual([1, 1]);
    expect(bodies.map((b) => b.content)).toEqual(["Good morning", undefined]);
    expect(bodies.every((b) => b.username === "Moses, Leader of Many")).toBe(true);
  });
});
