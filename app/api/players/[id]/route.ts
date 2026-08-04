import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { PhotoUploadError, savePlayerPhoto } from "@/lib/uploads";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const player = await prisma.player.findUnique({ where: { id } });
  if (!player) return NextResponse.json({ error: "Player not found" }, { status: 404 });

  return NextResponse.json({ player });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.player.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Player not found" }, { status: 404 });

  const formData = await request.formData();
  const name = formData.get("name");
  const bio = formData.get("bio");
  const photo = formData.get("photo");

  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  let photoUrl = existing.photoUrl;
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

  const player = await prisma.player.update({
    where: { id },
    data: {
      name: name.trim(),
      bio: typeof bio === "string" && bio.trim() !== "" ? bio.trim() : null,
      photoUrl,
    },
  });

  return NextResponse.json({ player });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.player.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Player not found" }, { status: 404 });

  const participantCount = await prisma.matchParticipant.count({ where: { playerId: id } });
  if (participantCount > 0) {
    return NextResponse.json(
      { error: "Cannot delete a player who is already assigned to a match" },
      { status: 409 },
    );
  }

  await prisma.player.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
