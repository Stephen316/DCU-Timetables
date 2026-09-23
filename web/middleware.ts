import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/// Refreshes the Supabase session cookie on every request. Without this, a Server
/// Component reads an expired token and the console logs you out mid-task.
///
/// This does NOT enforce access — the layout and RLS do that. Treating middleware as the
/// gate is a common way to ship an admin console that anyone can read.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list: { name: string; value: string; options?: Record<string, unknown> }[]) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  await supabase.auth.getUser();
  return response;
}

/// Every path this matches costs a round-trip to Supabase's auth server, because
/// `getUser()` revalidates the token rather than trusting it. Fonts and images do not need
/// a session, and in development each reload was spending three of these where one would
/// do — two of them on woff2 files.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|__nextjs_font|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
