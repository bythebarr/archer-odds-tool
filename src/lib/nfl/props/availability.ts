/**
 * v1.1 availability context: who is ruled out (Out/Doubtful on the official
 * injury report) and what usage that frees up for teammates. Walk-forward like
 * the engine: `context()` reads state before the week, `foldWeek()` adds it.
 *
 * Vacated share: an absent player's own decayed target/carry share (from the
 * usage-group state, with the frozen shrinkage), discounted by how long he's
 * already been gone:
 *
 *     vacated = share × 0.5^(k / usageHalfLife)
 *
 * where k = team games played since his last appearance. A teammate's
 * decayed share mixes games with and without him, and that factor is roughly
 * the weight still on games he played in. So a fresh absence frees his full
 * share, and a month-long one frees almost nothing that the lagged shares
 * haven't already absorbed. Only players whose last game was for this team
 * count (a traded player vacates nothing here).
 *
 * QB out: the team's presumed starter (its leading passer last game) is ruled
 * out, so a backup starts.
 */
import type { PlayerGameKey, PropState } from "./engine";
import { components, type ShrinkParams } from "./model";
import type { PlayerGame, SkillPosition } from "./playerGames";
import type { InjuryEntry } from "./injuries";

export interface AvailabilityContext {
  /** Vacated target share by the absent players' position. */
  vacTgt: Record<SkillPosition, number>;
  vacCar: Record<SkillPosition, number>;
  qbOut: boolean;
  /** Who's ruled out and what each frees up — presentation data for the "why" panel. */
  absent: { name: string; position: SkillPosition; vacTgt: number; vacCar: number }[];
}

export const NO_ABSENCES: AvailabilityContext = {
  vacTgt: { QB: 0, RB: 0, WR: 0, TE: 0 },
  vacCar: { QB: 0, RB: 0, WR: 0, TE: 0 },
  qbOut: false,
  absent: [],
};

export class AvailabilityTracker {
  private readonly teamGames = new Map<string, number>();
  /** playerId → { team, team game index } of his most recent appearance. */
  private readonly lastSeen = new Map<string, { team: string; teamGame: number; position: SkillPosition; name: string }>();

  constructor(private readonly usageHalfLife: number) {}

  /**
   * Availability for `team` in the week of `key`, given that week's ruled-out
   * list. `usage` must hold the pre-week state.
   */
  context(team: string, key: Omit<PlayerGameKey, "playerId" | "name" | "position" | "team">, out: readonly InjuryEntry[], usage: PropState, shrink: ShrinkParams, leadPasser: string | undefined): AvailabilityContext {
    const ctx: AvailabilityContext = { vacTgt: { QB: 0, RB: 0, WR: 0, TE: 0 }, vacCar: { QB: 0, RB: 0, WR: 0, TE: 0 }, qbOut: false, absent: [] };
    const games = this.teamGames.get(team) ?? 0;
    for (const e of out) {
      const seen = this.lastSeen.get(e.playerId);
      if (!seen || seen.team !== team) continue;
      if (e.playerId === leadPasser) ctx.qbOut = true;
      const k = games - seen.teamGame;
      const weight = Math.pow(0.5, k / this.usageHalfLife);
      const snap = usage.snapshot({ ...key, team, playerId: e.playerId, name: seen.name, position: seen.position }, undefined, "");
      if (snap.player.games <= 0) continue;
      const c = components({ usage: snap, efficiency: snap }, shrink);
      ctx.vacTgt[seen.position] += c.tgtShare * weight;
      ctx.vacCar[seen.position] += c.carShare * weight;
      ctx.absent.push({ name: seen.name, position: seen.position, vacTgt: c.tgtShare * weight, vacCar: c.carShare * weight });
    }
    return ctx;
  }

  foldWeek(wk: readonly PlayerGame[]): void {
    const teams = new Set(wk.map((p) => p.team));
    for (const t of teams) this.teamGames.set(t, (this.teamGames.get(t) ?? 0) + 1);
    for (const p of wk) this.lastSeen.set(p.playerId, { team: p.team, teamGame: this.teamGames.get(p.team)!, position: p.position, name: p.name });
  }
}

const sum = (r: Record<SkillPosition, number>) => r.QB + r.RB + r.WR + r.TE;

/** Regressors for the share redistribution: this player's share × vacated share (same position / other positions), scaled by 1/(1 − total vacated). */
export function redistributionTerms(vac: Record<SkillPosition, number>, position: SkillPosition): { same: number; other: number } {
  const total = Math.min(0.9, sum(vac));
  const same = vac[position];
  return { same: same / (1 - total), other: (total - same) / (1 - total) };
}
