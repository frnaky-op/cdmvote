import { NextResponse } from "next/server";
import { getBigscreenStatus } from "@/lib/match-state";

export async function GET() {
  const status = await getBigscreenStatus();
  return NextResponse.json(status);
}
