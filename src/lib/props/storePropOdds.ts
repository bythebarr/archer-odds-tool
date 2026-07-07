import { prisma } from "@/lib/prisma";
import type { OddsApiBookmaker } from "@/lib/odds/oddsApiClient";
import { ALLOWED_BOOK_KEYS } from "@/lib/odds/bookAllowlist";
import { MARKET_KEY_TO_STAT_CATEGORY } from "./propMarkets";
import type { Side } from "@/generated/prisma/client";

function isAllowedBook(key: string): boolean {
  return (ALLOWED_BOOK_KEYS as readonly string[]).includes(key);
}

function outcomeNameToSide(name: string): Side | null {
  if (name === "Over") return "over";
  if (name === "Under") return "under";
  return null;
}

/**
 * Strips diacritics and case so Odds API's plain-ASCII player names (e.g.
 * "Ivan Herrera") match MlbPlayer.fullName's accented MLB Stats API
 * spelling ("Iván Herrera") — confirmed live as a real mismatch, not
 * hypothetical, and common given MLB's many Latin American players.
 */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export type PlayerNameIndex = Map<string, string>;

/**
 * Bulk-loads every MlbPlayer once into a normalized-name -> id index, meant
 * to be built once per poll run and reused across every game — avoids one
 * DB query per distinct player name that storePlayerPropOdds would
 * otherwise issue (a full slate touches hundreds of player names).
 */
export async function buildPlayerNameIndex(): Promise<PlayerNameIndex> {
  const players = await prisma.mlbPlayer.findMany({ select: { id: true, fullName: true } });
  const index: PlayerNameIndex = new Map();
  for (const player of players) {
    index.set(normalizeName(player.fullName), player.id);
  }
  return index;
}

export interface StorePropOddsResult {
  snapshotsWritten: number;
  unmatchedPlayerNames: string[];
}

/**
 * Writes every allowed book's player-prop odds for one game: an append-only
 * PlayerPropSnapshot row per (book, statCategory, side, point) plus an
 * upserted CurrentPlayerPropLine, mirroring storeOdds.ts's game-line
 * pattern. Players are matched via the caller-supplied normalized-name
 * index (see buildPlayerNameIndex) against the already-populated MlbPlayer
 * table (from the hit-rate backfill) — never upserted here, since a prop
 * for a player we have no game-log history for would be useless to the
 * hit-rate UI anyway. Unmatched names are returned rather than thrown on,
 * so one naming mismatch doesn't drop an entire game's props.
 */
export async function storePlayerPropOdds(
  gameId: string,
  bookmakers: OddsApiBookmaker[],
  playerNameIndex: PlayerNameIndex
): Promise<StorePropOddsResult> {
  let snapshotsWritten = 0;
  const unmatchedPlayerNames = new Set<string>();

  for (const bookmaker of bookmakers) {
    if (!isAllowedBook(bookmaker.key)) continue;

    await prisma.sportsbook.upsert({
      where: { key: bookmaker.key },
      create: { key: bookmaker.key, displayName: bookmaker.title, region: "us" },
      update: { displayName: bookmaker.title },
    });

    const polledAt = new Date();

    for (const market of bookmaker.markets) {
      const statCategory = MARKET_KEY_TO_STAT_CATEGORY[market.key];
      if (!statCategory) continue;
      const sourceLastUpdate = new Date(market.last_update ?? bookmaker.last_update ?? polledAt);

      for (const outcome of market.outcomes) {
        const side = outcomeNameToSide(outcome.name);
        if (!side || !outcome.description || outcome.point == null) continue;

        const mlbPlayerId = playerNameIndex.get(normalizeName(outcome.description));
        if (!mlbPlayerId) {
          unmatchedPlayerNames.add(outcome.description);
          continue;
        }

        await prisma.playerPropSnapshot.create({
          data: {
            gameId,
            mlbPlayerId,
            bookKey: bookmaker.key,
            statCategory,
            side,
            point: outcome.point,
            priceAmerican: outcome.price,
            polledAt,
            sourceLastUpdate,
          },
        });
        snapshotsWritten++;

        await prisma.currentPlayerPropLine.upsert({
          where: {
            gameId_mlbPlayerId_bookKey_statCategory_side_point: {
              gameId,
              mlbPlayerId,
              bookKey: bookmaker.key,
              statCategory,
              side,
              point: outcome.point,
            },
          },
          create: {
            gameId,
            mlbPlayerId,
            bookKey: bookmaker.key,
            statCategory,
            side,
            point: outcome.point,
            priceAmerican: outcome.price,
            polledAt,
          },
          update: {
            priceAmerican: outcome.price,
            polledAt,
          },
        });
      }
    }
  }

  return { snapshotsWritten, unmatchedPlayerNames: [...unmatchedPlayerNames] };
}
