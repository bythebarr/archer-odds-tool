import { teamLogoSources } from "@/lib/logos";
import { TEAM_COLORS } from "@/lib/teamColors";
import { Logo } from "./Logo";

interface TeamBadgeProps {
  abbreviation: string;
  name: string;
  size?: number;
}

/** Team logo (falls back to a colored initials badge) — the Logo+teamLogoSources+TEAM_COLORS wiring used everywhere a team is shown. */
export function TeamBadge({ abbreviation, name, size }: TeamBadgeProps) {
  return (
    <Logo
      sources={teamLogoSources(abbreviation)}
      alt={name}
      fallbackText={abbreviation}
      color={TEAM_COLORS[abbreviation]}
      size={size}
    />
  );
}
