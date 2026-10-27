import type { Offer, OfferSide } from "@/lib/gameModel/offers";

export interface TeamNames {
  home: { name: string; abbreviation: string };
  away: { name: string; abbreviation: string };
}

export const PERIOD_LABEL: Record<string, string> = {
  game: "Game",
  h1: "1st Half",
  h2: "2nd Half",
  q1: "1st Quarter",
  q2: "2nd Quarter",
  q3: "3rd Quarter",
  q4: "4th Quarter",
};

const KIND_LABEL = { ml: "Moneyline", spread: "Spread", total: "Total", teamTotal: "Team Total", btts: "Both Teams to Score", dnb: "Draw No Bet" } as const;

/** "1st Half Spread", "Team Total", "Moneyline". */
export function offerTitle(o: Offer): string {
  const period = o.period === "game" ? "" : `${PERIOD_LABEL[o.period]} `;
  return `${period}${KIND_LABEL[o.kind]}`;
}

export function signedLine(x: number): string {
  if (x === 0) return "PK";
  return x > 0 ? `+${x}` : `−${Math.abs(x)}`;
}

/** How a side reads: "Celtics −5.5", "Over 224.5", "BOS Over 114.5", "Draw". `short` uses abbreviations. */
export function sideLabel(o: Offer, s: OfferSide, teams: TeamNames, short = false): string {
  const team = (k: string) => (k === "home" ? teams.home : teams.away);
  const name = (k: string) => (short ? team(k).abbreviation : team(k).name.split(" ").at(-1)!);
  if (s.side === "draw") return "Draw";
  if (o.kind === "btts") return s.side === "yes" ? "Yes" : "No";
  if (o.kind === "ml" || o.kind === "dnb") return name(s.side);
  if (o.kind === "spread") return `${name(s.side)} ${signedLine(s.point)}`;
  const ou = s.side === "over" ? "Over" : "Under";
  if (o.kind === "teamTotal") return `${team(o.team).abbreviation} ${short ? ou[0] : ou} ${s.point}`;
  return short ? `${ou[0]} ${s.point}` : `${ou} ${s.point}`;
}
