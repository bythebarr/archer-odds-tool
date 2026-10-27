/**
 * The F1 race model (lib/f1/raceModel.ts) for the next Grand Prix: ratings
 * replayed over every race, the current lineup from the latest race, and
 * simulated win / podium / points / teammate odds.
 */
import { prisma } from "@/lib/prisma";
import { loadF1Races } from "@/lib/f1/raceData";
import { DEFAULT_F1_OPTS, F1Ratings, simulateRace, type DriverOdds, type F1ModelOpts } from "@/lib/f1/raceModel";
import { getNextRace, type F1NextRace } from "./f1";
import { flagForNationality } from "@/lib/f1/flags";

export interface F1DriverOddsRow extends DriverOdds {
  name: string;
  code: string | null;
  ergastDriverId: string;
  constructorName: string;
  ergastConstructorId: string;
  flag: string;
}

export interface F1RaceModelView {
  race: F1NextRace;
  rows: F1DriverOddsRow[];
  /** True when the learning rates came from the backtest's fit. */
  fitted: boolean;
  racesReplayed: number;
}

async function fittedOpts(): Promise<F1ModelOpts | null> {
  const r = await prisma.modelReport.findFirst({ where: { model: "f1-races:podium" }, orderBy: { createdAt: "desc" }, select: { extra: true } });
  const o = (r?.extra as { opts?: F1ModelOpts } | null | undefined)?.opts;
  return o && typeof o.carRate === "number" ? o : null;
}

export async function getF1RaceModel(): Promise<F1RaceModelView | null> {
  const [race, races, fit] = await Promise.all([getNextRace(), loadF1Races(), fittedOpts()]);
  if (!race || races.length < 5) return null;
  const ratings = new F1Ratings(fit ?? DEFAULT_F1_OPTS);
  for (const r of races) {
    ratings.touch(r.entries, r.season);
    ratings.update(r);
  }
  // The lineup: whoever started the latest race, in the seat they drove.
  const entries = races[races.length - 1].entries.map((e) => ({ driverId: e.driverId, constructorId: e.constructorId }));
  ratings.touch(entries, race.season);
  const odds = simulateRace(ratings, entries);

  const [drivers, constructors] = await Promise.all([
    prisma.f1Driver.findMany({ where: { id: { in: entries.map((e) => e.driverId) } }, select: { id: true, givenName: true, familyName: true, code: true, ergastDriverId: true, nationality: true } }),
    prisma.f1Constructor.findMany({ where: { id: { in: entries.map((e) => e.constructorId) } }, select: { id: true, name: true, ergastConstructorId: true } }),
  ]);
  const d = new Map(drivers.map((x) => [x.id, x]));
  const c = new Map(constructors.map((x) => [x.id, x]));
  return {
    race,
    fitted: fit !== null,
    racesReplayed: races.length,
    rows: odds.map((o) => ({
      ...o,
      name: d.get(o.driverId) ? `${d.get(o.driverId)!.givenName} ${d.get(o.driverId)!.familyName}` : o.driverId,
      code: d.get(o.driverId)?.code ?? null,
      ergastDriverId: d.get(o.driverId)?.ergastDriverId ?? "",
      constructorName: c.get(o.constructorId)?.name ?? "",
      ergastConstructorId: c.get(o.constructorId)?.ergastConstructorId ?? "",
      flag: flagForNationality(d.get(o.driverId)?.nationality ?? null),
    })),
  };
}
