import { flagForNation } from "@/lib/nationality";
import { FlagBadge } from "./FlagBadge";
import { TeamBadge } from "./TeamBadge";

/**
 * A soccer team's avatar. Soccer here is the FIFA World Cup — national teams —
 * so the identity is the nation's flag. Falls back to the initials TeamBadge
 * for anything unmapped (e.g. a club competition added later).
 */
export function SoccerTeamBadge({
  name,
  abbreviation,
  size = 28,
}: {
  name: string;
  abbreviation?: string | null;
  size?: number;
}) {
  const flag = flagForNation(name);
  if (!flag) return <TeamBadge abbreviation={abbreviation ?? name} name={name} size={size} />;
  return <FlagBadge flag={flag} title={name} size={size} />;
}
