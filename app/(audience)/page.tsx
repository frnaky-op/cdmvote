import { getCurrentMatchStatus } from "@/lib/match-state";
import { getVoterId } from "@/lib/voter";
import { AudienceShell } from "./audience-shell";

export default async function AudiencePage() {
  const voterId = await getVoterId();
  const initialStatus = await getCurrentMatchStatus(voterId);

  return <AudienceShell initialStatus={initialStatus} />;
}
