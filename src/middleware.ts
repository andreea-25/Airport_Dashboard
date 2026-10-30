import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// First line of defence only: every page, server action and API route checks the session again on the server.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname === "/api/health" || pathname.startsWith("/_next") || pathname === "/favicon.ico") return NextResponse.next();
  const token = req.cookies.get("aw_session")?.value;
  let role: string | null = null;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET!));
      role = payload.role as string;
    } catch {
      role = null;
    }
  }
  if (!role) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Neautentificat" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if ((pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) && role !== "ADMIN") {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Acces interzis" }, { status: 403 });
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
