import { NextResponse } from "next/server";
import { getCurrentMatchStatus } from "@/lib/match-state";
import { getVoterId } from "@/lib/voter";

export async function GET() {
  const voterId = await getVoterId();
  const status = await getCurrentMatchStatus(voterId);
  return NextResponse.json(status);
}
