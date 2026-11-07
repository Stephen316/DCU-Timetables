-- ---------------------------------------------------------------------------
-- Phase 44 — an admin must have passed two-step sign-in
-- ---------------------------------------------------------------------------
--
-- Until now one password was all that stood between an attacker and the admin account: a
-- password reused from a breached site, or phished, was the whole console. This makes the
-- database treat an account as an admin only in a session that has also passed its TOTP
-- check (Supabase's "aal2"). A session that has only the password is a student's.
--
-- ⚠️  DO NOT RUN THIS FIRST. Do these in order, or you lock yourself out of your own
--     console and have to come back to the SQL editor to undo it:
--
--       1. Run phase 43 (the console unlock is enforced in the database).
--       2. Deploy the console with the two-step sign-in (web/src/app/unlock).
--       3. Sign in to the console, open Security → Two-step sign-in, and set up the
--          authenticator app. Do it for every admin account.
--       4. Sign out, then sign in again with email, password and the six-digit code, to
--          see that it works.
--       5. Only then run this file.
--
--     Undo (in the SQL editor): re-run the `create or replace` below without the last
--     condition.
--
-- The check lives in private.has_admin_role(), which phase 43 made the single place that
-- asks "is this an admin?", so every admin function and policy follows it, and so does
-- opening the console: a session without the second step cannot unlock it at all.
--
-- Cost to know about: an admin signed in to the mobile app is not at aal2 there, so the
-- app treats them as an ordinary student. Nothing in the app needs the admin role.
--
-- Safe to re-run.

create or replace function private.has_admin_role() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

revoke all on function private.has_admin_role() from public, anon, authenticated;
