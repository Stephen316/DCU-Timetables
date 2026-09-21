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

/// The signed-in profile, or null. Every page calls this; the layout turns null into a
/// redirect. Note the role is read from the database on each request rather than trusted
/// from a cookie — a demotion takes effect on the next page load, not the next hour.
export async function currentProfile() {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, role, pi, display_name, banned_until")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (!data) return null;
  return { ...data, email: auth.user.email ?? "", role: data.role as Role };
}
