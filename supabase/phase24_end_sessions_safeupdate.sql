-- ---------------------------------------------------------------------------
-- Phase 24 — "sign out every browser" runs through the API
-- ---------------------------------------------------------------------------
--
-- The same fault as phase 23. Phase 22's end_console_sessions ended with an UPDATE of
-- console_sessions with no WHERE clause, which pg_safeupdate refuses on every API request
-- — "UPDATE requires a WHERE clause" — so the Security page's sign-out-all always failed.
--
-- The UPDATE now touches only browsers that are unlocked. The rest need no change, and
-- leaving their updated_at alone matters: console_code_status counts wrong codes on rows
-- updated in the last 24 hours, and restamping every row brought a week of old wrong
-- codes back into "today".

create or replace function public.end_console_sessions() returns int
  language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  delete from auth.sessions s using public.console_sessions c where s.id = c.session_id;
  get diagnostics n = row_count;
  update public.console_sessions set unlocked_until = null, updated_at = now()
   where unlocked_until is not null;
  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'console.sign_out_all', 'console', null, jsonb_build_object('sessions', n));
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Grants — restated, as in every phase since 8
-- ---------------------------------------------------------------------------

revoke all    on function public.end_console_sessions() from public, anon;
grant execute on function public.end_console_sessions() to authenticated;
