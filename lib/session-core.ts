import { jwtVerify } from "jose";

// No `next/headers` import here — this module must stay Edge-safe so
// middleware.ts (which can't use next/headers) can share it with lib/session.ts.
export const SESSION_COOKIE_NAME = "session";

export function getSessionSecretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
}

export async function verifySessionToken(
  token: string,
): Promise<{ adminUserId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecretKey());
    if (typeof payload.adminUserId !== "string") return null;
    return { adminUserId: payload.adminUserId };
  } catch {
    return null;
  }
}
