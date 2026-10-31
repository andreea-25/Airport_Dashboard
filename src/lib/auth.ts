import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { redirect } from "next/navigation";
import { cache } from "react";
import { prisma } from "./db";
import type { Role } from "@/generated/prisma/enums";

const COOKIE = "aw_session";
const MAX_AGE = 60 * 60 * 12; // 12h

export type Session = { userId: string; role: Role; employeeId: string | null; email: string };

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET missing or too short");
  return new TextEncoder().encode(s);
}

export async function createSession(s: Session) {
  const token = await new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // only over HTTPS; set COOKIE_SECURE=true when deployed behind HTTPS (keeps http://<ip>:3000 working on the LAN)
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function verifyToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      userId: payload.userId as string,
      role: payload.role as Role,
      employeeId: (payload.employeeId as string | null) ?? null,
      email: payload.email as string,
    };
  } catch {
    return null;
  }
}

/**
 * Session from the cookie, checked against the database (once per request).
 * After `db:seed` / `local:reset` the users get new ids, so an old cookie points to nobody:
 * treat it as logged out instead of failing later on foreign keys.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const s = await verifyToken((await cookies()).get(COOKIE)?.value);
  if (!s) return null;
  const u = await prisma.user.findUnique({ where: { id: s.userId }, select: { id: true, role: true, employeeId: true, email: true } });
  if (!u) return null;
  return { userId: u.id, role: u.role, employeeId: u.employeeId, email: u.email };
});

/** For pages: redirect to /login if not authenticated. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** For pages: redirect non-admins away. */
export async function requireAdminPage(): Promise<Session> {
  const s = await requireSession();
  if (s.role !== "ADMIN") redirect("/");
  return s;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

/** For server actions / route handlers: throws instead of redirecting. */
export async function assertSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new AuthError("Neautentificat", 401);
  return s;
}

export async function assertAdmin(): Promise<Session> {
  const s = await assertSession();
  if (s.role !== "ADMIN") throw new AuthError("Acces interzis");
  return s;
}

export const SESSION_COOKIE = COOKIE;
