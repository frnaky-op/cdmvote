import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

export const VOTER_COOKIE_NAME = "voterId";
const VOTER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year — covers the whole event

/**
 * Reads the anonymous voter cookie if present. Does not issue one.
 */
export async function getVoterId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(VOTER_COOKIE_NAME)?.value ?? null;
}

/**
 * Reads the anonymous voter cookie, issuing one if this is the voter's
 * first visit. Only call from a Route Handler / Server Action — Server
 * Components can't set cookies.
 */
export async function getOrCreateVoterId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(VOTER_COOKIE_NAME)?.value;
  if (existing) return existing;

  const voterId = randomUUID();
  cookieStore.set(VOTER_COOKIE_NAME, voterId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: VOTER_COOKIE_MAX_AGE_SECONDS,
  });
  return voterId;
}
