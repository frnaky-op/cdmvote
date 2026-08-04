import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { PhotoUploadError, savePlayerPhoto } from "@/lib/uploads";

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const players = await prisma.player.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ players });
}

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const name = formData.get("name");
  const bio = formData.get("bio");
  const photo = formData.get("photo");

  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const tournament = await prisma.tournament.findFirst();
  if (!tournament) {
    return NextResponse.json(
      { error: "No tournament exists — run the seed script first" },
      { status: 500 },
    );
  }

  let photoUrl: string | null = null;
  if (photo instanceof File && photo.size > 0) {
    try {
      photoUrl = await savePlayerPhoto(photo);
    } catch (error) {
      if (error instanceof PhotoUploadError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  }

  const player = await prisma.player.create({
    data: {
      tournamentId: tournament.id,
      name: name.trim(),
      bio: typeof bio === "string" && bio.trim() !== "" ? bio.trim() : null,
      photoUrl,
    },
  });

  return NextResponse.json({ player }, { status: 201 });
}
