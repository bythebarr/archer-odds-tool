// Ergast/Jolpica reports nationality as a demonym ("British", "Dutch",
// "Monegasque"), not a country code — so we map those to a flag emoji for the
// FlagBadge chip, the same no-asset identity approach tennis and soccer use.
// Covers the current grid plus recent-era nationalities; anything unmapped
// falls back to the checkered flag rather than showing nothing.
const DEMONYM_FLAG: Record<string, string> = {
  British: "🇬🇧",
  Dutch: "🇳🇱",
  Spanish: "🇪🇸",
  Monegasque: "🇲🇨",
  Mexican: "🇲🇽",
  German: "🇩🇪",
  French: "🇫🇷",
  Finnish: "🇫🇮",
  Australian: "🇦🇺",
  Canadian: "🇨🇦",
  Italian: "🇮🇹",
  Japanese: "🇯🇵",
  Thai: "🇹🇭",
  American: "🇺🇸",
  Danish: "🇩🇰",
  Chinese: "🇨🇳",
  "New Zealander": "🇳🇿",
  Brazilian: "🇧🇷",
  Argentine: "🇦🇷",
  Argentinian: "🇦🇷",
  Austrian: "🇦🇹",
  Belgian: "🇧🇪",
  Swiss: "🇨🇭",
  Swedish: "🇸🇪",
  Russian: "🇷🇺",
  Polish: "🇵🇱",
  Portuguese: "🇵🇹",
  Indian: "🇮🇳",
  Hungarian: "🇭🇺",
  Estonian: "🇪🇪",
  Irish: "🇮🇪",
  "South African": "🇿🇦",
  Colombian: "🇨🇴",
  Venezuelan: "🇻🇪",
  Indonesian: "🇮🇩",
};

export function flagForNationality(nationality: string | null | undefined): string {
  if (!nationality) return "🏁";
  return DEMONYM_FLAG[nationality] ?? "🏁";
}
