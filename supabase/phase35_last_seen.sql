-- ---------------------------------------------------------------------------
-- Phase 35 — when each account last opened the app
-- ---------------------------------------------------------------------------
--
-- Nothing recorded whether anyone came back, so there was no way to tell whether a change
-- brought students back or not. This keeps one timestamp per account, enough to count
-- active students by week of the semester (the query at the end of this file).
--
--   last_seen_at  when the app was last opened signed in, to the day. Null until the
--                 first launch after this phase.
--
-- To the day on purpose: a finer trail of when a student opens the app says more about
-- them than the count needs. The app asks at most once a day, and the function writes
-- only when the stored value is a day old, so a burst of launches is one write.
--
-- Read only by admins, through the console's SQL: the column adds nothing to what a
-- student can read of their own row that they didn't already know.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

alter table profiles add column if not exists last_seen_at timestamptz;

create index if not exists profiles_last_seen_at_idx on profiles (last_seen_at);

create or replace function public.touch_last_seen()
  returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.profiles
     set last_seen_at = date_trunc('day', now())
   where id = auth.uid()
     and (last_seen_at is null or last_seen_at < date_trunc('day', now()));
end $$;

revoke all    on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;

-- ---------------------------------------------------------------------------
-- Usage
-- ---------------------------------------------------------------------------
--
-- One timestamp per account says who was back in the last week, not a history, so run this
-- once a week (or from a scheduled job into a table of your own) to build up the trend:
--
--   select count(*) filter (where last_seen_at >= now() - interval '7 days')  as active_7d,
--          count(*) filter (where last_seen_at >= now() - interval '28 days') as active_28d,
--          count(*)                                                           as accounts
--     from profiles;
