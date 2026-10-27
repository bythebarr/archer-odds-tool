/**
 * What we know about a league beyond what the odds feed says: its proper name,
 * its country, where ESPN keeps it (for crests, the league logo and last
 * season's results), and how high it sorts. Keyed by our league id
 * ("<sport>/<slug>", slugs from The Odds API's sport_key). A league missing here
 * still shows up — titled from the feed, sorted last, with a Wikipedia crest
 * lookup for its teams.
 */
export interface LeagueInfo {
  name: string;
  region: string;
  /** ESPN site-API path, e.g. "soccer/eng.1". */
  espn?: string;
  rank: number;
}

const soccer: Record<string, LeagueInfo> = {
  epl: { name: "Premier League", region: "England", espn: "soccer/eng.1", rank: 1 },
  "uefa-champs-league": { name: "Champions League", region: "Europe", espn: "soccer/uefa.champions", rank: 2 },
  "spain-la-liga": { name: "LaLiga", region: "Spain", espn: "soccer/esp.1", rank: 3 },
  "germany-bundesliga": { name: "Bundesliga", region: "Germany", espn: "soccer/ger.1", rank: 4 },
  "italy-serie-a": { name: "Serie A", region: "Italy", espn: "soccer/ita.1", rank: 5 },
  "france-ligue-one": { name: "Ligue 1", region: "France", espn: "soccer/fra.1", rank: 6 },
  "usa-mls": { name: "MLS", region: "USA", espn: "soccer/usa.1", rank: 7 },
  "uefa-europa-league": { name: "Europa League", region: "Europe", espn: "soccer/uefa.europa", rank: 8 },
  "uefa-europa-conference-league": { name: "Conference League", region: "Europe", espn: "soccer/uefa.europa.conf", rank: 9 },
  "mexico-ligamx": { name: "Liga MX", region: "Mexico", espn: "soccer/mex.1", rank: 10 },
  "fifa-world-cup": { name: "World Cup", region: "International", espn: "soccer/fifa.world", rank: 0 },
  "efl-champ": { name: "Championship", region: "England", espn: "soccer/eng.2", rank: 11 },
  "netherlands-eredivisie": { name: "Eredivisie", region: "Netherlands", espn: "soccer/ned.1", rank: 12 },
  "portugal-primeira-liga": { name: "Primeira Liga", region: "Portugal", espn: "soccer/por.1", rank: 13 },
  "brazil-campeonato": { name: "Brasileirão", region: "Brazil", espn: "soccer/bra.1", rank: 14 },
  "argentina-primera-division": { name: "Liga Profesional", region: "Argentina", espn: "soccer/arg.1", rank: 15 },
  spl: { name: "Premiership", region: "Scotland", espn: "soccer/sco.1", rank: 16 },
  "turkey-super-league": { name: "Süper Lig", region: "Turkey", espn: "soccer/tur.1", rank: 17 },
  "belgium-first-div": { name: "Pro League", region: "Belgium", espn: "soccer/bel.1", rank: 18 },
  "saudi-arabia-pro-league": { name: "Saudi Pro League", region: "Saudi Arabia", espn: "soccer/ksa.1", rank: 19 },
  "fa-cup": { name: "FA Cup", region: "England", espn: "soccer/eng.fa", rank: 20 },
  "england-efl-cup": { name: "Carabao Cup", region: "England", espn: "soccer/eng.league_cup", rank: 21 },
  "spain-copa-del-rey": { name: "Copa del Rey", region: "Spain", espn: "soccer/esp.copa_del_rey", rank: 22 },
  "germany-dfb-pokal": { name: "DFB-Pokal", region: "Germany", espn: "soccer/ger.dfb_pokal", rank: 23 },
  "italy-coppa-italia": { name: "Coppa Italia", region: "Italy", espn: "soccer/ita.coppa_italia", rank: 24 },
  "france-coupe-de-france": { name: "Coupe de France", region: "France", espn: "soccer/fra.coupe_de_france", rank: 25 },
  "conmebol-copa-libertadores": { name: "Copa Libertadores", region: "South America", espn: "soccer/conmebol.libertadores", rank: 26 },
  "conmebol-copa-sudamericana": { name: "Copa Sudamericana", region: "South America", espn: "soccer/conmebol.sudamericana", rank: 27 },
  "england-league1": { name: "League One", region: "England", espn: "soccer/eng.3", rank: 30 },
  "england-league2": { name: "League Two", region: "England", espn: "soccer/eng.4", rank: 31 },
  "spain-segunda-division": { name: "LaLiga 2", region: "Spain", espn: "soccer/esp.2", rank: 32 },
  "germany-bundesliga2": { name: "2. Bundesliga", region: "Germany", espn: "soccer/ger.2", rank: 33 },
  "germany-liga3": { name: "3. Liga", region: "Germany", rank: 34 },
  "italy-serie-b": { name: "Serie B", region: "Italy", espn: "soccer/ita.2", rank: 35 },
  "france-ligue-two": { name: "Ligue 2", region: "France", espn: "soccer/fra.2", rank: 36 },
  "brazil-serie-b": { name: "Série B", region: "Brazil", espn: "soccer/bra.2", rank: 37 },
  "austria-bundesliga": { name: "Bundesliga", region: "Austria", espn: "soccer/aut.1", rank: 40 },
  "switzerland-superleague": { name: "Super League", region: "Switzerland", espn: "soccer/sui.1", rank: 41 },
  "greece-super-league": { name: "Super League", region: "Greece", espn: "soccer/gre.1", rank: 42 },
  "denmark-superliga": { name: "Superliga", region: "Denmark", espn: "soccer/den.1", rank: 43 },
  "norway-eliteserien": { name: "Eliteserien", region: "Norway", espn: "soccer/nor.1", rank: 44 },
  "sweden-allsvenskan": { name: "Allsvenskan", region: "Sweden", espn: "soccer/swe.1", rank: 45 },
  "sweden-superettan": { name: "Superettan", region: "Sweden", rank: 46 },
  "finland-veikkausliiga": { name: "Veikkausliiga", region: "Finland", rank: 47 },
  "poland-ekstraklasa": { name: "Ekstraklasa", region: "Poland", rank: 48 },
  "russia-premier-league": { name: "Premier League", region: "Russia", espn: "soccer/rus.1", rank: 49 },
  "league-of-ireland": { name: "Premier Division", region: "Ireland", rank: 50 },
  "chile-campeonato": { name: "Primera División", region: "Chile", espn: "soccer/chi.1", rank: 51 },
  "japan-j-league": { name: "J1 League", region: "Japan", espn: "soccer/jpn.1", rank: 52 },
  "korea-kleague1": { name: "K League 1", region: "South Korea", rank: 53 },
  "china-superleague": { name: "Super League", region: "China", espn: "soccer/chn.1", rank: 54 },
  "australia-aleague": { name: "A-League", region: "Australia", espn: "soccer/aus.1", rank: 55 },
  "uefa-nations-league": { name: "Nations League", region: "Europe", espn: "soccer/uefa.nations", rank: 28 },
  "uefa-champs-league-qualification": { name: "Champions League Qualifying", region: "Europe", espn: "soccer/uefa.champions_qual", rank: 29 },
  "uefa-champs-league-women": { name: "Women's Champions League", region: "Europe", espn: "soccer/uefa.wchampions", rank: 60 },
  "uefa-european-championship": { name: "Euro", region: "International", espn: "soccer/uefa.euro", rank: 0 },
  "uefa-euro-qualification": { name: "Euro Qualifying", region: "International", espn: "soccer/uefa.euroq", rank: 29 },
  "fifa-world-cup-qualifiers-europe": { name: "World Cup Qualifying — UEFA", region: "International", espn: "soccer/fifa.worldq.uefa", rank: 29 },
  "fifa-world-cup-qualifiers-south-america": { name: "World Cup Qualifying — CONMEBOL", region: "International", espn: "soccer/fifa.worldq.conmebol", rank: 29 },
  "fifa-club-world-cup": { name: "Club World Cup", region: "International", espn: "soccer/fifa.cwc", rank: 1 },
  "fifa-world-cup-womens": { name: "Women's World Cup", region: "International", espn: "soccer/fifa.wwc", rank: 2 },
  "concacaf-gold-cup": { name: "Gold Cup", region: "North America", espn: "soccer/concacaf.gold", rank: 26 },
  "concacaf-leagues-cup": { name: "Leagues Cup", region: "North America", espn: "soccer/concacaf.leagues.cup", rank: 26 },
  "conmebol-copa-america": { name: "Copa América", region: "International", espn: "soccer/conmebol.america", rank: 1 },
  "africa-cup-of-nations": { name: "Africa Cup of Nations", region: "International", espn: "soccer/caf.nations", rank: 26 },
  "germany-bundesliga-women": { name: "Frauen-Bundesliga", region: "Germany", rank: 61 },
  "fifa-world-cup-winner": { name: "World Cup Winner", region: "International", rank: 5 },
};

const other: Record<string, LeagueInfo> = {
  "hockey/nhl": { name: "NHL", region: "USA", espn: "hockey/nhl", rank: 1 },
  "hockey/nhl-championship-winner": { name: "Stanley Cup Winner", region: "USA", rank: 2 },
  "hockey/ahl": { name: "AHL", region: "USA", rank: 10 },
  "hockey/sweden-hockey-league": { name: "SHL", region: "Sweden", rank: 11 },
  "hockey/sweden-allsvenskan": { name: "HockeyAllsvenskan", region: "Sweden", rank: 12 },
  "hockey/liiga": { name: "Liiga", region: "Finland", rank: 13 },
  "hockey/mestis": { name: "Mestis", region: "Finland", rank: 14 },
  "basketball/ncaab": { name: "College Basketball", region: "USA", espn: "basketball/mens-college-basketball", rank: 1 },
  "basketball/wncaab": { name: "Women's College Basketball", region: "USA", espn: "basketball/womens-college-basketball", rank: 5 },
  "basketball/wnba": { name: "WNBA", region: "USA", espn: "basketball/wnba", rank: 2 },
  "basketball/euroleague": { name: "EuroLeague", region: "Europe", espn: "basketball/euroleague", rank: 3 },
  "basketball/nbl": { name: "NBL", region: "Australia", espn: "basketball/nbl", rank: 4 },
  "basketball/nba-championship-winner": { name: "NBA Championship Winner", region: "USA", rank: 0 },
  "basketball/ncaab-championship-winner": { name: "National Championship Winner", region: "USA", rank: 6 },
  "football/ncaaf": { name: "College Football", region: "USA", espn: "football/college-football", rank: 1 },
  "football/ncaaf-fcs": { name: "College Football — FCS", region: "USA", espn: "football/college-football", rank: 4 },
  "football/cfl": { name: "CFL", region: "Canada", espn: "football/cfl", rank: 2 },
  "football/ufl": { name: "UFL", region: "USA", espn: "football/ufl", rank: 3 },
  "football/nfl-super-bowl-winner": { name: "Super Bowl Winner", region: "USA", rank: 0 },
  "football/ncaaf-championship-winner": { name: "CFP National Champion", region: "USA", rank: 5 },
  "baseball/mlb-world-series-winner": { name: "World Series Winner", region: "USA", rank: 0 },
  "baseball/kbo": { name: "KBO", region: "South Korea", rank: 2 },
  "baseball/npb": { name: "NPB", region: "Japan", rank: 3 },
  "baseball/ncaa": { name: "College Baseball", region: "USA", espn: "baseball/college-baseball", rank: 4 },
  "baseball/milb": { name: "Minor League Baseball", region: "USA", rank: 5 },
  "aussie-rules/afl": { name: "AFL", region: "Australia", espn: "australian-football/afl", rank: 1 },
  "aussie-rules/aflw": { name: "AFLW", region: "Australia", rank: 2 },
  "rugby-league/nrl": { name: "NRL", region: "Australia", espn: "rugby-league/3", rank: 1 },
  "rugby-league/nrl-state-of-origin": { name: "State of Origin", region: "Australia", rank: 2 },
  "rugby-league/nrlw": { name: "NRLW", region: "Australia", rank: 3 },
  "rugby-union/six-nations": { name: "Six Nations", region: "Europe", espn: "rugby/180659", rank: 1 },
  "lacrosse/pll": { name: "PLL", region: "USA", espn: "lacrosse/pll", rank: 1 },
  "lacrosse/ncaa": { name: "College Lacrosse", region: "USA", rank: 2 },
  "handball/germany-bundesliga": { name: "Handball-Bundesliga", region: "Germany", rank: 1 },
  "cricket/ipl": { name: "IPL", region: "India", rank: 1 },
  "cricket/test-match": { name: "Test Matches", region: "International", rank: 2 },
  "cricket/odi": { name: "One Day Internationals", region: "International", rank: 3 },
  "cricket/international-t20": { name: "T20 Internationals", region: "International", rank: 4 },
  "cricket/big-bash": { name: "Big Bash League", region: "Australia", rank: 5 },
  "cricket/psl": { name: "Pakistan Super League", region: "Pakistan", rank: 6 },
  "cricket/the-hundred": { name: "The Hundred", region: "England", rank: 7 },
  "cricket/t20-blast": { name: "T20 Blast", region: "England", rank: 8 },
  "cricket/caribbean-premier-league": { name: "Caribbean Premier League", region: "West Indies", rank: 9 },
  "golf/masters-tournament-winner": { name: "The Masters", region: "USA", rank: 1 },
  "golf/pga-championship-winner": { name: "PGA Championship", region: "USA", rank: 2 },
  "golf/us-open-winner": { name: "U.S. Open", region: "USA", rank: 3 },
  "golf/the-open-championship-winner": { name: "The Open", region: "UK", rank: 4 },
  "boxing/boxing": { name: "Boxing", region: "International", rank: 1 },
};

export function leagueInfo(leagueId: string): LeagueInfo | null {
  if (leagueId.startsWith("soccer/")) return soccer[leagueId.slice(7)] ?? null;
  return other[leagueId] ?? null;
}

/** "ATP Paris Masters", "WTA Finals": a tennis key's slug made readable. */
export function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => (/^(atp|wta|itf|nba|nfl|nhl|ahl|afl|nrl|ipl|odi|psl|ufl|cfl|usa|uefa|fifa|efl|mls|t20)$/.test(w) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}
