import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, accessToken, sameString } from "@/lib/access";

/**
 * Keeps deployed copies private (see lib/access.ts).
 *
 * - SITE_PASSWORD set: every page needs the login cookie.
 * - Not set, `npm run dev`: open, so local development is unchanged.
 * - Not set, production build: closed. A deployment where someone forgot the
 *   password must not quietly become public.
 */
export async function middleware(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;

  if (!password) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse(
      "This copy of Hindsight is private. Set SITE_PASSWORD in the hosting environment to open it.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const cookie = request.cookies.get(ACCESS_COOKIE)?.value ?? "";
  if (sameString(cookie, await accessToken(password))) return NextResponse.next();

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the login page itself and Next's static files.
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
