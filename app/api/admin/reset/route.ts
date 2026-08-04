import { NextResponse } from "next/server";
import { resetTournamentData } from "@/lib/admin-reset";
import { requireSession } from "@/lib/session";

export async function POST() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await resetTournamentData();
  return NextResponse.json({ ok: true });
}
