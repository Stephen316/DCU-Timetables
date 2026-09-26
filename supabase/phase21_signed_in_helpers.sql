-- ---------------------------------------------------------------------------
-- Phase 21 — is_admin, is_banned and is_trusted are for signed-in users only
-- ---------------------------------------------------------------------------
--
-- Supabase's linter (0028_anon_security_definer_function_executable) found these three
-- callable without signing in, at /rest/v1/rpc/is_admin and the rest: Postgres grants
-- `execute` to everyone by default, and phase 0 never took it back. Each only answers
-- "am I …?" for the caller, and a caller with no session is none of them, so nothing leaked
-- — but nothing signed out has any reason to ask.
--
-- The RLS policies that call them stay as they are. A signed-out request to one of those
-- tables now fails with "permission denied for function is_admin" instead of returning no
-- rows, which is the same answer, said louder. The app shows nothing before sign-in.
--
-- What the linter will still list, on purpose (0029_authenticated_security_definer_function
-- _executable): every function the app and console call. They are the API, so signed-in
-- users must be able to execute them, and each checks its caller in its first lines —
-- is_admin() for the console's, auth.uid() for a student's own rows, is_trusted() for
-- verifying. Audited 24 Sep 2026. These three can't become `security invoker` either: they
-- read `profiles`, whose own policy calls is_admin(), and that recursion is phase 0's
-- 42P17.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

revoke execute on function public.is_admin()   from public, anon;
revoke execute on function public.is_banned()  from public, anon;
revoke execute on function public.is_trusted() from public, anon;
grant  execute on function public.is_admin()   to authenticated, service_role;
grant  execute on function public.is_banned()  to authenticated, service_role;
grant  execute on function public.is_trusted() to authenticated, service_role;
