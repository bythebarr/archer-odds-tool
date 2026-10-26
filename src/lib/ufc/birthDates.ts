/**
 * Fighters' dates of birth, from Wikidata — free, public, and the only open
 * source that has them (Cito, our fight-data feed, doesn't). Age is the single
 * strongest factor in public UFC models, so the fight model reads it.
 *
 * One SPARQL query returns every person whose occupation is mixed martial
 * artist (Q11607585) with a date of birth. Names are matched to our fighters after
 * normalizing accents and punctuation; a name Wikidata gives two different
 * birthdays is ambiguous and skipped rather than guessed. Only fighters
 * without a date are written, so a daily run is cheap.
 */
import { prisma } from "@/lib/prisma";

const ENDPOINT = "https://query.wikidata.org/sparql";
const QUERY = `
SELECT ?item ?itemLabel ?dob WHERE {
  ?item wdt:P106 wd:Q11607585 ;
        wdt:P569 ?dob .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

export function normalizeFighterName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’-]/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface SparqlResponse {
  results?: { bindings?: { itemLabel?: { value?: string }; dob?: { value?: string } }[] };
}

/** name key → date of birth; names with conflicting dates are dropped. Exported for tests. */
export function parseBirthDates(payload: unknown): Map<string, Date> {
  const out = new Map<string, Date>();
  const conflicted = new Set<string>();
  for (const b of (payload as SparqlResponse | null)?.results?.bindings ?? []) {
    const name = b.itemLabel?.value;
    const dob = b.dob?.value ? new Date(b.dob.value) : null;
    if (!name || !dob || Number.isNaN(dob.getTime()) || /^Q\d+$/.test(name)) continue;
    const key = normalizeFighterName(name);
    const prev = out.get(key);
    if (prev && prev.toISOString().slice(0, 10) !== dob.toISOString().slice(0, 10)) conflicted.add(key);
    else out.set(key, dob);
  }
  for (const k of conflicted) out.delete(k);
  return out;
}

export async function syncUfcBirthDates(): Promise<{ candidates: number; matched: number; missingBefore: number }> {
  const missing = await prisma.ufcFighter.findMany({ where: { birthDate: null }, select: { id: true, fullName: true } });
  if (missing.length === 0) return { candidates: 0, matched: 0, missingBefore: 0 };
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(QUERY)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": "ARCHR-Edge/1.0 (sports analytics; contact via site)" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Wikidata ${res.status}`);
  const dates = parseBirthDates(await res.json());
  let matched = 0;
  for (const f of missing) {
    const dob = dates.get(normalizeFighterName(f.fullName));
    if (!dob) continue;
    await prisma.ufcFighter.update({ where: { id: f.id }, data: { birthDate: dob } });
    matched++;
  }
  return { candidates: dates.size, matched, missingBefore: missing.length };
}
