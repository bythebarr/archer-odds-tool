/**
 * Every UFC fight since 1994 from UFCStats, through a public mirror of its
 * scrape (github.com/Greco1899/scrape_ufc_stats, refreshed after each event):
 * events, results, each round's stat line and each fighter's height, reach,
 * stance and date of birth. Free, and the same numbers Cito serves.
 *
 * Merges into the Cito tables rather than beside them: a fighter matches on
 * the UFCStats id once linked, else on his normalized name; an event on its
 * date; a bout on its two fighters within the event. Whatever Cito already
 * wrote stays — the archive fills results, stats and physicals it lacks.
 * Resumable: events go oldest first and a fully linked event is skipped.
 */
import { prisma } from "@/lib/prisma";
import { parseCsv } from "@/lib/tennis/archive";
import { parseStatLine, type ParsedStatLine } from "./citoStats";
import type { CitoStatLine } from "./citoApiClient";
import { weightClassLbs } from "./fightModel";

const MIRROR = "https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main";

type Row = Record<string, string>;
const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const hashOf = (url: string | undefined) => clean(url).split("/").filter(Boolean).at(-1) ?? "";
export const normalizeFighterName = (s: string) =>
  clean(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ");
const slugOf = (s: string) => normalizeFighterName(s).replace(/ /g, "-");

function table(text: string): Row[] {
  const [head, ...rows] = parseCsv(text);
  if (!head) return [];
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [clean(h), r[i] ?? ""])));
}

async function fetchTable(name: string): Promise<Row[]> {
  const res = await fetch(`${MIRROR}/${name}.csv`);
  if (!res.ok) throw new Error(`UFCStats mirror ${name}: ${res.status}`);
  return table(await res.text());
}

/** `5' 11"` → 71. */
export function parseHeight(s: string): number | null {
  const m = clean(s).match(/(\d+)'\s*(\d+)"/);
  return m ? Number(m[1]) * 12 + Number(m[2]) : null;
}
/** `72"` → 72. */
export function parseReach(s: string): number | null {
  const m = clean(s).match(/^(\d+(?:\.\d+)?)"$/);
  return m ? Number(m[1]) : null;
}
function parseDate(s: string): Date | null {
  const t = clean(s);
  if (!t || t === "--") return null;
  const d = new Date(`${t} 00:00:00 UTC`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "UFC Women's Flyweight Title Bout" → { weightClass: "Women's Flyweight", title: true }. */
export function parseWeightClass(s: string): { weightClass: string; title: boolean } {
  const t = clean(s);
  const title = /title/i.test(t);
  const wc = t
    .replace(/\bUFC\b/gi, "")
    .replace(/\b(Interim|Title|Bout|Tournament|Ultimate Fighter \d+|Ultimate Fighter|TUF \d+|Latin America \d*|China|Brazil \d*|Nations Canada vs\. Australia|Australia vs\. UK)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return { weightClass: wc || t || "Open Weight", title };
}

/** One round's (or a round-less bout's) stat row as the landed/attempted columns. */
export function statsRow(r: Row): ParsedStatLine {
  const line: CitoStatLine = {
    fighterSlug: "",
    fighterName: r.FIGHTER ?? "",
    knockdowns: Number(r.KD) || 0,
    significantStrikes: clean(r["SIG.STR."]),
    totalStrikes: clean(r["TOTAL STR."]),
    takedowns: clean(r.TD),
    submissionAttempts: Number(r["SUB.ATT"]) || 0,
    reversals: Number(r["REV."]) || 0,
    controlTime: clean(r.CTRL),
    head: clean(r.HEAD),
    body: clean(r.BODY),
    leg: clean(r.LEG),
    distance: clean(r.DISTANCE),
    clinch: clean(r.CLINCH),
    ground: clean(r.GROUND),
  };
  return parseStatLine(line);
}

export function sumStats(rows: ParsedStatLine[]): ParsedStatLine {
  const out = { ...rows[0]! };
  for (const k of Object.keys(out) as (keyof ParsedStatLine)[]) out[k] = rows.reduce((a, r) => a + r[k], 0);
  return out;
}

export interface UfcStatsImportSummary {
  events: number;
  boutsLinked: number;
  boutsCreated: number;
  statsWritten: number;
  fightersCreated: number;
  remaining: number;
}

/** Imports (or links) the archive, oldest event first, until `deadline`. */
export async function importUfcStatsArchive({ deadline = Date.now() + 45_000 }: { deadline?: number } = {}): Promise<UfcStatsImportSummary> {
  const [events, results, stats, fighterRows, tott] = await Promise.all(
    ["ufc_event_details", "ufc_fight_results", "ufc_fight_stats", "ufc_fighter_details", "ufc_fighter_tott"].map(fetchTable),
  );

  // Fighters: UFCStats id → name and physicals; name → ids (a handful of names are shared).
  const physical = new Map(tott.map((t) => [hashOf(t.URL), t]));
  const byName = new Map<string, string[]>();
  const nameOf = new Map<string, string>();
  for (const f of fighterRows) {
    const id = hashOf(f.URL);
    const name = clean(`${f.FIRST} ${f.LAST}`);
    nameOf.set(id, name);
    const k = normalizeFighterName(name);
    byName.set(k, [...(byName.get(k) ?? []), id]);
  }
  /** The UFCStats id for a name on a card at `lbs`: the namesake whose listed weight is closest. */
  const resolve = (name: string, lbs: number | null): string | null => {
    const ids = byName.get(normalizeFighterName(name)) ?? [];
    if (ids.length <= 1) return ids[0] ?? null;
    const w = (id: string) => Number(clean(physical.get(id)?.WEIGHT).replace(/[^\d.]/g, "")) || 0;
    return [...ids].sort((a, b) => Math.abs(w(a) - (lbs ?? 0)) - Math.abs(w(b) - (lbs ?? 0)))[0]!;
  };

  const resultsByEvent = new Map<string, Row[]>();
  for (const r of results) resultsByEvent.set(clean(r.EVENT), [...(resultsByEvent.get(clean(r.EVENT)) ?? []), r]);
  const statsByBout = new Map<string, Row[]>();
  for (const s of stats) {
    const k = `${clean(s.EVENT)}|${clean(s.BOUT)}`;
    statsByBout.set(k, [...(statsByBout.get(k) ?? []), s]);
  }

  const ordered = events
    .map((e) => ({ id: hashOf(e.URL), name: clean(e.EVENT), date: parseDate(e.DATE), location: clean(e.LOCATION) }))
    .filter((e): e is typeof e & { date: Date } => !!e.id && !!e.date && resultsByEvent.has(e.name))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Events already fully linked are done.
  const linkedEvents = await prisma.ufcEvent.findMany({
    where: { ufcStatsId: { in: ordered.map((e) => e.id) } },
    select: { ufcStatsId: true, _count: { select: { bouts: { where: { ufcStatsId: { not: null } } } } } },
  });
  const linkedCount = new Map(linkedEvents.map((e) => [e.ufcStatsId!, e._count.bouts]));
  // A bout whose fighters the mirror can't name is skipped, so it doesn't keep its event open.
  const linkable = (rows: Row[]) =>
    rows.filter((r) => {
      const [a, b] = clean(r.BOUT).split(/ vs\.? /i).map(clean);
      const lbs = weightClassLbs(parseWeightClass(r.WEIGHTCLASS).weightClass);
      return a && b && hashOf(r.URL) && resolve(a, lbs) && resolve(b, lbs);
    }).length;
  const todo = ordered.filter((e) => (linkedCount.get(e.id) ?? -1) < linkable(resultsByEvent.get(e.name)!));

  const fighterIds = new Map<string, string>();
  const known = await prisma.ufcFighter.findMany({ select: { id: true, ufcStatsId: true, fullName: true } });
  const dbByName = new Map<string, string[]>();
  for (const f of known) {
    if (f.ufcStatsId) fighterIds.set(f.ufcStatsId, f.id);
    else dbByName.set(normalizeFighterName(f.fullName), [...(dbByName.get(normalizeFighterName(f.fullName)) ?? []), f.id]);
  }
  const usedSlugs = new Set((await prisma.ufcFighter.findMany({ select: { citoSlug: true } })).map((f) => f.citoSlug));

  const summary: UfcStatsImportSummary = { events: 0, boutsLinked: 0, boutsCreated: 0, statsWritten: 0, fightersCreated: 0, remaining: 0 };

  /** His row if we already know it: linked, or the one Cito row with his name. Creates nothing. */
  const lookup = (ufcId: string, fallbackName: string): string | undefined => {
    const same = dbByName.get(normalizeFighterName(nameOf.get(ufcId) ?? fallbackName));
    const free = same?.filter((id) => !linked.has(id));
    return fighterIds.get(ufcId) ?? (free?.length === 1 ? free[0] : undefined);
  };
  const linked = new Set(fighterIds.values());

  /** His row, linking a Cito row (`citoId` when the card already told us which) or creating one. */
  async function fighterId(ufcId: string, fallbackName: string, citoId?: string): Promise<string> {
    const hit = fighterIds.get(ufcId);
    if (hit) return hit;
    const name = nameOf.get(ufcId) ?? fallbackName;
    const t = physical.get(ufcId);
    const phys = {
      heightInches: t ? parseHeight(t.HEIGHT) : null,
      reachInches: t ? parseReach(t.REACH) : null,
      stance: clean(t?.STANCE) || null,
      birthDate: t ? parseDate(t.DOB) : null,
    };
    // A Cito row with the same name (and only one) is the same man.
    const same = citoId ? [citoId] : dbByName.get(normalizeFighterName(name))?.filter((x) => !linked.has(x));
    let id: string;
    if (same?.length === 1) {
      id = same[0]!;
      if (!citoId) dbByName.delete(normalizeFighterName(name));
      const cur = await prisma.ufcFighter.findUnique({ where: { id }, select: { heightInches: true, reachInches: true, stance: true, birthDate: true } });
      await prisma.ufcFighter.update({
        where: { id },
        data: {
          ufcStatsId: ufcId,
          ...(cur?.heightInches == null && phys.heightInches ? { heightInches: phys.heightInches } : {}),
          ...(cur?.reachInches == null && phys.reachInches ? { reachInches: phys.reachInches } : {}),
          ...(cur?.stance == null && phys.stance ? { stance: phys.stance } : {}),
          ...(cur?.birthDate == null && phys.birthDate ? { birthDate: phys.birthDate } : {}),
        },
      });
    } else {
      let slug = slugOf(name) || ufcId;
      if (usedSlugs.has(slug)) slug = `${slug}-${ufcId.slice(0, 6)}`;
      usedSlugs.add(slug);
      id = (await prisma.ufcFighter.create({ data: { citoSlug: slug, ufcStatsId: ufcId, fullName: name, ...phys }, select: { id: true } })).id;
      summary.fightersCreated++;
    }
    fighterIds.set(ufcId, id);
    linked.add(id);
    return id;
  }

  for (const ev of todo) {
    if (Date.now() > deadline) break;
    // The event: linked already, else Cito's on the same day, else new.
    let event = await prisma.ufcEvent.findUnique({ where: { ufcStatsId: ev.id }, select: { id: true } });
    if (!event) {
      const near = await prisma.ufcEvent.findFirst({
        where: { ufcStatsId: null, eventDate: { gte: new Date(ev.date.getTime() - 36 * 3_600_000), lte: new Date(ev.date.getTime() + 36 * 3_600_000) } },
        select: { id: true },
      });
      const [city, , country] = ev.location.split(",").map((x) => x.trim());
      event = near
        ? await prisma.ufcEvent.update({ where: { id: near.id }, data: { ufcStatsId: ev.id }, select: { id: true } })
        : await prisma.ufcEvent.create({
            data: { citoEventId: `ufcstats:${ev.id}`, citoSlug: `ufcstats-${ev.id}`, ufcStatsId: ev.id, title: ev.name, eventDate: ev.date, city: city || null, country: (country ?? ev.location.split(",").at(-1)?.trim()) || null, hasStats: true },
            select: { id: true },
          });
    }
    const existing = await prisma.ufcBout.findMany({ where: { eventId: event.id }, select: { id: true, ufcStatsId: true, redCornerFighterId: true, blueCornerFighterId: true, statsFetchedAt: true, status: true } });

    const card = resultsByEvent.get(ev.name)!;
    for (const [i, r] of card.entries()) {
      const boutName = clean(r.BOUT);
      const [nameA, nameB] = boutName.split(/ vs\.? /i).map(clean);
      const boutHash = hashOf(r.URL);
      if (!nameA || !nameB || !boutHash) continue;
      const { weightClass, title } = parseWeightClass(r.WEIGHTCLASS);
      const lbs = weightClassLbs(weightClass);
      const ua = resolve(nameA, lbs);
      const ub = resolve(nameB, lbs);
      if (!ua || !ub) continue;
      // Cito may spell one of them differently: if the other is known and his bout on this card
      // is already there, the unmatched name is that bout's other corner.
      let la = lookup(ua, nameA);
      let lb = lookup(ub, nameB);
      const cornerAgainst = (id: string) => {
        // This bout, linked on an earlier run, or Cito's not yet linked one with him in it.
        const x = existing.find((e) => (e.ufcStatsId === boutHash || !e.ufcStatsId) && (e.redCornerFighterId === id || e.blueCornerFighterId === id));
        const other = x ? (x.redCornerFighterId === id ? x.blueCornerFighterId : x.redCornerFighterId) : undefined;
        return other && !linked.has(other) ? other : undefined;
      };
      if (la && !lb) lb = cornerAgainst(la);
      else if (lb && !la) la = cornerAgainst(lb);
      const a = await fighterId(ua, nameA, la && !fighterIds.has(ua) ? la : undefined);
      const b = await fighterId(ub, nameB, lb && !fighterIds.has(ub) ? lb : undefined);
      const [oa] = clean(r.OUTCOME).split("/");
      const winner = oa === "W" ? a : oa === "L" ? b : null;
      const result = {
        status: "completed",
        winnerFighterId: winner,
        method: clean(r.METHOD) || null,
        methodDetails: clean(r.DETAILS) || null,
        resultRound: Number(r.ROUND) || null,
        resultTime: clean(r.TIME) || null,
      };

      let bout = existing.find((x) => x.ufcStatsId === boutHash) ?? existing.find((x) => !x.ufcStatsId && [x.redCornerFighterId, x.blueCornerFighterId].sort().join() === [a, b].sort().join());
      if (bout) {
        await prisma.ufcBout.update({ where: { id: bout.id }, data: { ufcStatsId: boutHash, ...(bout.status !== "completed" ? result : {}) } });
        summary.boutsLinked++;
      } else {
        const created = await prisma.ufcBout.create({
          data: { citoBoutId: `ufcstats:${boutHash}`, ufcStatsId: boutHash, eventId: event.id, weightClass, titleBout: title, boutOrder: i + 1, redCornerFighterId: a, blueCornerFighterId: b, ...result },
          select: { id: true, ufcStatsId: true, redCornerFighterId: true, blueCornerFighterId: true, statsFetchedAt: true, status: true },
        });
        bout = created;
        summary.boutsCreated++;
      }

      if (bout.statsFetchedAt) continue;
      const rows = statsByBout.get(`${ev.name}|${boutName}`) ?? [];
      const per = new Map<string, { rounds: Map<number, ParsedStatLine>; whole: ParsedStatLine | null }>();
      for (const s of rows) {
        const who = normalizeFighterName(s.FIGHTER) === normalizeFighterName(nameA) ? a : normalizeFighterName(s.FIGHTER) === normalizeFighterName(nameB) ? b : null;
        if (!who) continue;
        const cur = per.get(who) ?? { rounds: new Map(), whole: null };
        const round = Number(clean(s.ROUND).replace(/\D/g, ""));
        if (round) cur.rounds.set(round, statsRow(s));
        else cur.whole = statsRow(s);
        per.set(who, cur);
      }
      if (per.size !== 2) continue;
      for (const [who, v] of per) {
        const whole = v.whole ?? sumStats([...v.rounds.values()]);
        await prisma.ufcBoutFighterStats.upsert({ where: { boutId_fighterId: { boutId: bout.id, fighterId: who } }, create: { boutId: bout.id, fighterId: who, ...whole }, update: {} });
        if (v.rounds.size) await prisma.ufcBoutRoundStats.createMany({ data: [...v.rounds].map(([round, s]) => ({ boutId: bout.id, fighterId: who, round, ...s })), skipDuplicates: true });
      }
      await prisma.ufcBout.update({ where: { id: bout.id }, data: { statsFetchedAt: new Date() } });
      summary.statsWritten++;
    }
    summary.events++;
  }
  summary.remaining = todo.length - summary.events;
  return summary;
}
