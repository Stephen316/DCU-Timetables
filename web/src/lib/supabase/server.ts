import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/// Server-side client. Authenticates as the signed-in admin, so RLS still applies to
/// every query — the console is a convenience over the same rules the app obeys, never a
/// bypass. There is deliberately no service-role client anywhere in this project.
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list: { name: string; value: string; options?: Record<string, unknown> }[]) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Called from a Server Component, where cookies are read-only. The middleware
            // refreshes the session instead, so this is genuinely nothing to handle.
          }
        },
      },
    },
  );
}

export type Role = "student" | "trusted" | "admin";

/// The signed-in profile, or null when there is genuinely no session.
///
/// The role is read from the database on each request rather than trusted from a cookie —
/// a demotion takes effect on the next page load, not the next hour.
///
/// The important distinction here is between "not signed in" and "could not tell". Both
/// used to return null, and the layout turns null into a redirect to /unlock — so a slow
/// response or a blip from Supabase silently threw away a perfectly good session and asked
/// for the code again. A failure now throws, which the console's error boundary offers
/// to retry. Retrying a check is cheap; retyping a password because a network call wobbled
/// is not.
export async function currentProfile() {
  const store = await cookies();
  const hasSessionCookie = store
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));

  const supabase = await supabaseServer();
  const { data: auth, error } = await supabase.auth.getUser();

  // No cookie at all is the honest signed-out case: there is nothing to verify, and any
  // error alongside it is just supabase-js saying the same thing.
  if (!hasSessionCookie) return null;

  // A cookie exists but the check failed. Two very different reasons for that:
  //
  //   Supabase rejected the credentials — an expired or already-rotated refresh token,
  //   a missing session. That IS being signed out, and /unlock is the right answer.
  //
  //   Anything else — a timeout, a 5xx, DNS, a dropped connection. That is the console
  //   failing to ask the question, and answering it with "you are logged out" is what
  //   made a good session cost a sign-in.
  if (error) {
    const status = (error as { status?: number }).status ?? 0;
    const rejected = status === 400 || status === 401 || status === 403;
    if (rejected) return null;
    throw new Error(`Could not verify the session: ${error.message}`);
  }
  if (!auth.user) return null;

  const { data, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, pi, display_name, banned_until")
    .eq("id", auth.user.id)
    .maybeSingle();

  // Likewise: a failed profile read is not the same as having no profile. Only the latter
  // should send anyone back to the code screen.
  if (profileError) throw new Error(`Could not read your profile: ${profileError.message}`);
  if (!data) return null;
  return { ...data, email: auth.user.email ?? "", role: data.role as Role };
}
