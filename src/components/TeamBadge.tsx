import { teamLogoSources, mlbTeamLogoUrl } from "@/lib/logos";
import { TEAM_COLORS } from "@/lib/teamColors";
import { Logo } from "./Logo";

interface TeamBadgeProps {
  abbreviation: string;
  name: string;
  /** When set, the real MLB team crest (public CDN) is tried first, then local files, then the colored initials badge. */
  mlbTeamId?: number | null;
  size?: number;
}

/** Team logo (falls back to a colored initials badge) — the Logo+teamLogoSources+TEAM_COLORS wiring used everywhere a team is shown. */
export function TeamBadge({ abbreviation, name, mlbTeamId, size }: TeamBadgeProps) {
  const sources = [
    ...(mlbTeamId != null ? [mlbTeamLogoUrl(mlbTeamId)] : []),
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
