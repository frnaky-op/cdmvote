import { SignJWT } from "jose";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE_NAME,
  getSessionSecretKey,
  verifySessionToken,
} from "@/lib/session-core";

const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function createSession(adminUserId: string) {
  const token = await new SignJWT({ adminUserId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSessionSecretKey());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getSession(): Promise<{ adminUserId: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** For API route handlers: returns the session or null, no redirect. */
export async function requireSession() {
  return getSession();
}
