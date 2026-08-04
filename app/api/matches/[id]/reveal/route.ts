import { NextRequest, NextResponse } from "next/server";
import { revealMatch } from "@/lib/match-state";
import { requireSession } from "@/lib/session";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const resolveTieWith = Array.isArray(body?.resolveTieWith)
    ? (body.resolveTieWith as string[])
    : undefined;

  const result = await revealMatch(id, resolveTieWith);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code, tie: result.tie },
      { status: result.status },
    );
  }
  return NextResponse.json({ match: result.match, results: result.results });
}
