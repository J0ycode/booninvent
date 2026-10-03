import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/auth/session";

function signOut(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

export const GET = signOut;
export const POST = signOut;
