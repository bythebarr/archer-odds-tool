import { teamLogoSources, mlbTeamLogoUrl } from "@/lib/logos";
import { TEAM_COLORS } from "@/lib/teamColors";
import { Logo } from "./Logo";

interface TeamBadgeProps {
  abbreviation: string;
  name: string;
  /** When set, the real MLB team crest (public CDN) is tried first, then local files, then the colored initials badge. */
  mlbTeamId?: number | null;
  /** A league logo URL (e.g. espnTeamLogoUrl) tried before local files. */
  logoUrl?: string | null;
  size?: number;
}

/** Team logo (falls back to a colored initials badge) — the Logo+teamLogoSources+TEAM_COLORS wiring used everywhere a team is shown. */
export function TeamBadge({ abbreviation, name, mlbTeamId, logoUrl, size }: TeamBadgeProps) {
  const sources = [
    ...(mlbTeamId != null ? [mlbTeamLogoUrl(mlbTeamId)] : []),
    ...(logoUrl ? [logoUrl] : []),
    ...teamLogoSources(abbreviation),
  ];
  return (
    <Logo
      sources={sources}
      alt={name}
      fallbackText={abbreviation}
      color={TEAM_COLORS[abbreviation]}
      size={size}
    />
  );
}
