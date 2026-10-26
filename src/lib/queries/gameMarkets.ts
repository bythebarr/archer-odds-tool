/**
 * Every line on one NBA/NFL game, as the offers the sportsbook screen shows:
 * the main lines (CurrentOddsLine) plus alternates, team totals and every half
 * and quarter (GameMarketLine), each priced by the game model.
 */
import { prisma } from "@/lib/prisma";
import { GAME_MODEL_BY_SPORT, buildOffers, type LineQuote, type Offer } from "@/lib/gameModel";
import type { Period, MarketKind } from "@/lib/gameModel/markets";
import type { GameLineRow } from "./games";
import type { GameModelView } from "./gameModel";

const MAIN_KIND: Record<string, MarketKind> = { h2h: "ml", spreads: "spread", totals: "total" };

export async function getGameOffers(sport: "nba" | "nfl", gameId: string, mainLines: GameLineRow[], view: GameModelView | null): Promise<Offer[]> {
  const extra = await prisma.gameMarketLine.findMany({ where: { gameId }, include: { book: { select: { displayName: true } } } });
  const quotes: LineQuote[] = [
    // Alternates first, main lines last: where a book hangs the same number on both,
    // the main market's price is the one that stands (buildOffers keeps the last quote).
    ...extra.map((r): LineQuote => ({
      period: r.period as Period,
      kind: r.kind as MarketKind,
      side: r.side,
      team: r.team,
      point: r.point,
      bookKey: r.bookKey,
      bookName: r.book.displayName,
      priceAmerican: r.priceAmerican,
    })),
    ...mainLines.flatMap((l): LineQuote[] => {
      const kind = MAIN_KIND[l.marketType];
      if (!kind || l.isAlternate) return [];
      return [{ period: "game", kind, side: l.side, team: "", point: l.point ?? 0, bookKey: l.bookKey, bookName: l.bookName, priceAmerican: l.priceAmerican }];
    }),
  ];
  return buildOffers(
    quotes,
    view
      ? {
          league: GAME_MODEL_BY_SPORT[sport],
          expected: view.expected,
          spreads: { marginSd: view.marginSd, totalSd: view.totalSd },
          weights: view.weights,
          specs: view.periodSpecs,
        }
      : null
  );
}
