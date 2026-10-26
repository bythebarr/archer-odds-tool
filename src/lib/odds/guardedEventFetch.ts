/**
 * Per-event odds for a list of market keys, safe against keys the provider
 * doesn't offer. The Odds API rejects a whole request over one unknown key
 * (INVALID_MARKET), so keys go in small batches; a rejected batch is split
 * until the bad key is isolated, and that key is skipped for the rest of the
 * process. Shared by the props polls and the game-markets poll.
 */
import { fetchEventPlayerProps, type OddsApiEvent } from "./oddsApiClient";

const rejected = new Set<string>();
const BATCH = 8;

function invalidMarket(error: unknown): boolean {
  return /INVALID_MARKET|422/i.test(error instanceof Error ? error.message : String(error));
}

export interface GuardedFetchResult {
  /** One payload per successful batch (each carries a subset of the markets). */
  events: OddsApiEvent[];
  creditsUsed: number;
  creditsRemaining: number | null;
  /** Keys the provider rejected on this call. */
  rejectedKeys: string[];
}

export async function fetchEventMarketsGuarded(eventId: string, keys: string[], regions: string[], sportKey: string): Promise<GuardedFetchResult> {
  const out: GuardedFetchResult = { events: [], creditsUsed: 0, creditsRemaining: null, rejectedKeys: [] };
  const run = async (batch: string[]): Promise<void> => {
    if (batch.length === 0) return;
    try {
      const res = await fetchEventPlayerProps(eventId, batch, regions, sportKey);
      out.events.push(res.event);
      out.creditsUsed += res.creditsUsed ?? 0;
      out.creditsRemaining = res.creditsRemaining;
    } catch (error) {
      if (!invalidMarket(error)) throw error;
      if (batch.length === 1) {
        rejected.add(batch[0]);
        out.rejectedKeys.push(batch[0]);
        return;
      }
      const mid = Math.ceil(batch.length / 2);
      await run(batch.slice(0, mid));
      await run(batch.slice(mid));
    }
  };
  const live = keys.filter((k) => !rejected.has(k));
  for (let i = 0; i < live.length; i += BATCH) await run(live.slice(i, i + BATCH));
  return out;
}
