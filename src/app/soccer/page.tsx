import { permanentRedirect } from "next/navigation";

/** Soccer runs on the all-sports engine now: every league and tournament the feed carries, not one competition. */
export default function SoccerPage() {
  permanentRedirect("/sports/soccer");
}
