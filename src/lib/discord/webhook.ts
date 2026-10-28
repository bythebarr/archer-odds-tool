/**
 * Posting to a Discord webhook: the one place every poster (card, free play,
 * slate, recap, tip) goes through.
 *
 * Two Discord limits shape it. A message carries at most 10 embeds, and at most
 * 6,000 characters across all of them (titles, descriptions, footers, author
 * names). `batchEmbeds` splits a post into as many messages as those limits
 * need, in order, so a long slate posts in full instead of failing with a 400.
 * And a 429 says how long to wait: `postWebhook` waits that long (capped) and
 * tries once more before giving up.
 */
import { MOSES } from "./brand";

/** A Discord embed object, as the posters build it. */
export type Embed = object;

export const MAX_EMBEDS_PER_MESSAGE = 10;
export const MAX_CHARS_PER_MESSAGE = 6000;
/** Longest 429 wait we'll sit through inside a function call. */
const MAX_RETRY_WAIT_MS = 10_000;

function text(v: unknown): number {
  return typeof v === "string" ? v.length : 0;
}

/** The characters Discord counts toward a message's 6,000. */
export function embedChars(embed: Embed): number {
  const e = embed as Record<string, unknown>;
  const footer = e.footer as { text?: unknown } | undefined;
  const author = e.author as { name?: unknown } | undefined;
  const fields = (e.fields as Array<{ name?: unknown; value?: unknown }> | undefined) ?? [];
  return (
    text(e.title) +
    text(e.description) +
    text(footer?.text) +
    text(author?.name) +
    fields.reduce((n, f) => n + text(f.name) + text(f.value), 0)
  );
}

/** Split embeds, in order, into messages that each fit Discord's per-message limits. */
export function batchEmbeds(embeds: Embed[]): Embed[][] {
  const batches: Embed[][] = [];
  let cur: Embed[] = [];
  let chars = 0;
  for (const e of embeds) {
    const n = embedChars(e);
    if (cur.length && (cur.length >= MAX_EMBEDS_PER_MESSAGE || chars + n > MAX_CHARS_PER_MESSAGE)) {
      batches.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(e);
    chars += n;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST one message. A 429 waits Discord's `retry_after` (capped) and retries once; anything else non-2xx throws. */
export async function postWebhook(url: string, body: unknown): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    const detail = await res.text();
    if (res.status === 429 && attempt === 0) {
      let wait = 1000;
      try {
        const s = Number((JSON.parse(detail) as { retry_after?: unknown }).retry_after);
        if (Number.isFinite(s) && s > 0) wait = s * 1000;
      } catch {
        // Not JSON: keep the default wait.
      }
      if (wait <= MAX_RETRY_WAIT_MS) {
        await sleep(wait);
        continue;
      }
    }
    throw new Error(`Discord webhook failed: ${res.status} ${res.statusText} — ${detail}`);
  }
}

/**
 * Post embeds as Moses, split into as many messages as Discord's limits need.
 * `content` (the plain-text line above the embeds) rides the first message only.
 */
export async function postEmbeds(url: string, embeds: Embed[], content?: string): Promise<void> {
  const batches = batchEmbeds(embeds);
  if (!batches.length) batches.push([]);
  for (const [i, batch] of batches.entries()) {
    await postWebhook(url, { username: MOSES, ...(i === 0 && content ? { content } : {}), embeds: batch });
  }
}
