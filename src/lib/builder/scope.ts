/**
 * The parlay builder's Game and Team menus, read off the pool so they list only
 * what has legs: games soonest first, teams A–Z. Pure and client-safe.
 */
import type { BuilderLeg } from "./types";

export interface GameOption {
  id: string;
  sport: string;
  label: string;
  startsAt: string;
  legs: number;
  /** Team keys with legs in this game. */
  teams: string[];
}

export interface TeamOption {
  key: string;
  sport: string;
  /** "BOS", "Arsenal", a fighter's name. */
  label: string;
  legs: number;
}

/** Menus for the chosen sports (all when empty); the team menu narrows to the chosen game. */
export function scopeOptions(pool: BuilderLeg[], sports: string[], game?: string): { games: GameOption[]; teams: TeamOption[] } {
  const games = new Map<string, GameOption>();
  const teams = new Map<string, TeamOption>();
  for (const l of pool) {
    if (sports.length && !sports.includes(l.sport)) continue;
    const g = games.get(l.eventId) ?? games.set(l.eventId, { id: l.eventId, sport: l.sport, label: l.eventLabel, startsAt: l.startsAt, legs: 0, teams: [] }).get(l.eventId)!;
    g.legs++;
    for (const key of l.teams ?? []) if (!g.teams.includes(key)) g.teams.push(key);
    if (game && l.eventId !== game) continue;
    for (const key of l.teams ?? []) {
      const t = teams.get(key) ?? teams.set(key, { key, sport: l.sport, label: key.slice(key.indexOf(":") + 1), legs: 0 }).get(key)!;
      t.legs++;
    }
  }
  return {
    games: [...games.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.label.localeCompare(b.label)),
    teams: [...teams.values()].sort((a, b) => a.sport.localeCompare(b.sport) || a.label.localeCompare(b.label)),
  };
}
