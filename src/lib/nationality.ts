/**
 * Tennis-player nationality — the "face OR flag" treatment. The Odds API gives
 * us player NAMES only (no photo, no country), so, like teamColors.ts, this is
 * a hand-curated name → ISO 3166-1 alpha-2 map looked up at render time. No DB
 * column, no migration. Covers the current top ATP/WTA pool (the players who
 * actually appear in odds); anyone unmapped falls back to a neutral initials
 * badge. Extend freely as new names show up.
 */
const PLAYER_COUNTRY: Record<string, string> = {
  // ── ATP ──────────────────────────────────────────────────────────────────
  "Jannik Sinner": "IT",
  "Carlos Alcaraz": "ES",
  "Novak Djokovic": "RS",
  "Daniil Medvedev": "RU",
  "Alexander Zverev": "DE",
  "Andrey Rublev": "RU",
  "Casper Ruud": "NO",
  "Hubert Hurkacz": "PL",
  "Taylor Fritz": "US",
  "Grigor Dimitrov": "BG",
  "Alex de Minaur": "AU",
  "Stefanos Tsitsipas": "GR",
  "Tommy Paul": "US",
  "Ben Shelton": "US",
  "Frances Tiafoe": "US",
  "Holger Rune": "DK",
  "Karen Khachanov": "RU",
  "Sebastian Korda": "US",
  "Felix Auger-Aliassime": "CA",
  "Lorenzo Musetti": "IT",
  "Matteo Berrettini": "IT",
  "Cameron Norrie": "GB",
  "Nick Kyrgios": "AU",
  "Denis Shapovalov": "CA",
  "Gael Monfils": "FR",
  "Ugo Humbert": "FR",
  "Adrian Mannarino": "FR",
  "Jack Draper": "GB",
  "Arthur Fils": "FR",
  "Tomas Machac": "CZ",
  "Jiri Lehecka": "CZ",
  "Alejandro Davidovich Fokina": "ES",
  "Francisco Cerundolo": "AR",
  "Sebastian Baez": "AR",
  "Nicolas Jarry": "CL",
  "Alexei Popyrin": "AU",
  "Jordan Thompson": "AU",
  "Flavio Cobolli": "IT",
  "Lorenzo Sonego": "IT",
  "Alexander Bublik": "KZ",
  "Jaume Munar": "ES",
  "Marcos Giron": "US",
  "Marton Fucsovics": "HU",
  "Zizou Bergs": "BE",
  "Zachary Svajda": "US",
  "Arthur Fery": "GB",
  "Michael Zheng": "US",
  "Rafael Nadal": "ES",
  "Andy Murray": "GB",
  "Daniel Evans": "GB",
  "Botic van de Zandschulp": "NL",
  "Tallon Griekspoor": "NL",
  "Roberto Bautista Agut": "ES",
  "Pablo Carreno Busta": "ES",
  "Miomir Kecmanovic": "RS",
  "Laslo Djere": "RS",
  "Dusan Lajovic": "RS",
  "Marin Cilic": "HR",
  "Borna Coric": "HR",
  "Fabian Marozsan": "HU",
  "Kei Nishikori": "JP",
  "Yoshihito Nishioka": "JP",
  "Jan-Lennard Struff": "DE",
  "Dominik Koepfer": "DE",
  "Dominic Thiem": "AT",
  "Sebastian Ofner": "AT",
  "Thiago Monteiro": "BR",
  "Thiago Seyboth Wild": "BR",
  "Cristian Garin": "CL",
  "Alejandro Tabilo": "CL",
  "Tomas Martin Etcheverry": "AR",
  "Mariano Navone": "AR",
  "Aslan Karatsev": "RU",
  "Roman Safiullin": "RU",
  "Christopher Eubanks": "US",
  "Mackenzie McDonald": "US",
  "Brandon Nakashima": "US",
  "Alex Michelsen": "US",
  "Learner Tien": "US",
  "Nuno Borges": "PT",
  "Adam Walton": "AU",
  "Rinky Hijikata": "AU",
  "Aleksandar Vukic": "AU",
  "Chris O'Connell": "AU",
  "Corentin Moutet": "FR",
  "Arthur Rinderknech": "FR",
  "Benjamin Bonzi": "FR",
  "Richard Gasquet": "FR",
  "Luca Nardi": "IT",
  "Matteo Arnaldi": "IT",
  "Luciano Darderi": "IT",
  "Mattia Bellucci": "IT",
  "Jakub Mensik": "CZ",
  "Gabriel Diallo": "CA",
  "Emil Ruusuvuori": "FI",
  // ── WTA ──────────────────────────────────────────────────────────────────
  "Iga Swiatek": "PL",
  "Aryna Sabalenka": "BY",
  "Coco Gauff": "US",
  "Elena Rybakina": "KZ",
  "Jessica Pegula": "US",
  "Qinwen Zheng": "CN",
  "Jasmine Paolini": "IT",
  "Emma Navarro": "US",
  "Daria Kasatkina": "RU",
  "Barbora Krejcikova": "CZ",
  "Danielle Collins": "US",
  "Madison Keys": "US",
  "Beatriz Haddad Maia": "BR",
  "Ons Jabeur": "TN",
  "Marketa Vondrousova": "CZ",
  "Elina Svitolina": "UA",
  "Victoria Azarenka": "BY",
  "Naomi Osaka": "JP",
  "Emma Raducanu": "GB",
  "Mirra Andreeva": "RU",
  "Diana Shnaider": "RU",
  "Paula Badosa": "ES",
  "Anastasia Pavlyuchenkova": "RU",
  "Karolina Muchova": "CZ",
  "Liudmila Samsonova": "RU",
  "Leylah Fernandez": "CA",
  "Petra Kvitova": "CZ",
  "Caroline Garcia": "FR",
  "Elise Mertens": "BE",
  "Jelena Ostapenko": "LV",
  "Ekaterina Alexandrova": "RU",
  "Anna Kalinskaya": "RU",
  "Donna Vekic": "HR",
  "Katie Boulter": "GB",
  "Amanda Anisimova": "US",
  "Peyton Stearns": "US",
  "Magda Linette": "PL",
  "Linda Noskova": "CZ",
  "Marta Kostyuk": "UA",
  "Dayana Yastremska": "UA",
  "Clara Tauson": "DK",
  "Yulia Putintseva": "KZ",
  "Xinyu Wang": "CN",
};

/** Last-name → country, but only where every mapped player with that surname shares it (skips ambiguous surnames like Zheng). */
const SURNAME_COUNTRY: Record<string, string> = (() => {
  const groups: Record<string, Set<string>> = {};
  for (const [name, cc] of Object.entries(PLAYER_COUNTRY)) {
    const parts = name.trim().split(/\s+/);
    const surname = parts[parts.length - 1].toLowerCase();
    (groups[surname] ??= new Set()).add(cc);
  }
  const out: Record<string, string> = {};
  for (const [surname, set] of Object.entries(groups)) {
    if (set.size === 1) out[surname] = [...set][0];
  }
  return out;
})();

/** ISO alpha-2 country code for a player name (exact, then unambiguous surname), or null if unknown. */
export function countryOfPlayer(name: string): string | null {
  const trimmed = name.trim();
  if (PLAYER_COUNTRY[trimmed]) return PLAYER_COUNTRY[trimmed];
  const parts = trimmed.split(/\s+/);
  const surname = parts[parts.length - 1].toLowerCase();
  return SURNAME_COUNTRY[surname] ?? null;
}

/** Turn an ISO alpha-2 code into its flag emoji (regional-indicator letters), e.g. "ES" → 🇪🇸. */
export function flagEmoji(alpha2: string): string {
  const cc = alpha2.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65)));
}

// ── National teams (soccer) ─────────────────────────────────────────────────
// Soccer in this app is the FIFA World Cup, i.e. NATIONAL teams — a nation
// literally is its flag, so this is a better identity than any club-crest hunt.

/** Builds a subdivision (tag-sequence) flag emoji, e.g. subdivisionFlag("gbeng") → England's St George's cross. */
function subdivisionFlag(region: string): string {
  const tag = (s: string) => [...s].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join("");
  return `\u{1f3f4}${tag(region)}\u{e007f}`;
}

// England/Scotland/Wales field their own sides in soccer and have dedicated
// flag emoji (they aren't ISO countries, so regional-indicators don't apply).
const SUBDIVISION_FLAGS: Record<string, string> = {
  england: subdivisionFlag("gbeng"),
  scotland: subdivisionFlag("gbsct"),
  wales: subdivisionFlag("gbwls"),
};

/** National-team name (lower-cased) → ISO alpha-2. Covers the realistic World Cup / qualifier pool; aliases included. */
const NATION_CODE: Record<string, string> = {
  argentina: "AR", belgium: "BE", colombia: "CO", egypt: "EG", france: "FR",
  morocco: "MA", norway: "NO", switzerland: "CH", usa: "US", "united states": "US",
  brazil: "BR", germany: "DE", spain: "ES", italy: "IT", portugal: "PT",
  netherlands: "NL", croatia: "HR", uruguay: "UY", mexico: "MX", japan: "JP",
  "south korea": "KR", "korea republic": "KR", australia: "AU", canada: "CA",
  denmark: "DK", sweden: "SE", poland: "PL", serbia: "RS", senegal: "SN",
  ghana: "GH", nigeria: "NG", cameroon: "CM", tunisia: "TN", algeria: "DZ",
  ecuador: "EC", peru: "PE", chile: "CL", paraguay: "PY", "costa rica": "CR",
  panama: "PA", qatar: "QA", "saudi arabia": "SA", iran: "IR", austria: "AT",
  czechia: "CZ", "czech republic": "CZ", turkey: "TR", ukraine: "UA", greece: "GR",
  hungary: "HU", romania: "RO", ireland: "IE", "republic of ireland": "IE",
  slovakia: "SK", slovenia: "SI", "ivory coast": "CI", "cote d'ivoire": "CI",
  mali: "ML", "south africa": "ZA", "new zealand": "NZ", venezuela: "VE",
  bolivia: "BO", honduras: "HN", jamaica: "JM", scotland: "GB", wales: "GB",
};

/** Flag emoji for a national-team name (subdivision flags first, then country code), or null if unmapped. */
export function flagForNation(name: string): string | null {
  const key = name.trim().toLowerCase();
  if (SUBDIVISION_FLAGS[key]) return SUBDIVISION_FLAGS[key];
  const cc = NATION_CODE[key];
  return cc ? flagEmoji(cc) : null;
}
