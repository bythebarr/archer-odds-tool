import { permanentRedirect } from "next/navigation";

/** Tennis runs on the all-sports engine now: every league and tournament the feed carries, not one competition. */
export default function TennisPage() {
  permanentRedirect("/sports/tennis");
}
