-- ---------------------------------------------------------------------------
-- Phase 36 — what the caller's own reports and deadlines came to
-- ---------------------------------------------------------------------------
--
-- A student who reports a cancellation or adds a deadline never hears what came of it, so
-- there's little reason to do it again. This returns the caller's own contributions that
-- made a difference, for the app to say so once ("Your report was one of 4 that called it
-- off"):
--
--   report    a class the caller reported cancelled that the crowd then called off (the
--             app's bar: 3 reports, 2 more than "it went ahead", see CancellationRules)
--             or an organiser's verdict confirmed. `count` is everyone who reported it.
--   deadline  a deadline the caller added that two or more others confirmed, or that a
--             moderator verified. `count` is the others who confirmed it.
--
-- Only the last 14 days, by when the caller reported or added it: the app shows each one
-- once and remembers which, so older ones would only ever be skipped.
--
-- Nothing here identifies anyone else. The counts are the ones cancellation_tallies and
-- deadline_confirmation_tallies already give every student, with the same rule that a
-- banned account's vote doesn't count.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

create or replace function public.my_recent_contributions()
  returns table (kind text, ref text, module_key text, title text, count bigint, happened_at timestamptz)
  language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid()::text as id),
  mine as (
    select r.event_key, r.reported_at
      from public.cancellation_reports r, me
     where r.reporter_id = me.id and r.stance = 'cancelled'
       and r.reported_at > now() - interval '14 days'
  ),
  tallies as (
    select r.event_key,
           count(distinct r.reporter_id) filter (where r.stance = 'cancelled') as cancelled,
           count(distinct r.reporter_id) filter (where r.stance = 'on')        as went_ahead
      from public.cancellation_reports r
      left join public.profiles p on p.id::text = r.reporter_id
     where r.event_key in (select event_key from mine)
       and not coalesce(p.banned_until > now(), false)
     group by r.event_key
  )
  select 'report', m.event_key, v.module_key, null::text, t.cancelled, m.reported_at
    from mine m
    join tallies t on t.event_key = m.event_key
    left join public.event_verdicts v on v.event_key = m.event_key
   where (v.state = 'cancelled')
      or (v.state is null and t.cancelled >= 3 and t.cancelled - t.went_ahead >= 2)
  union all
  select 'deadline', d.id::text, d.module_key, d.title,
         (select count(*)
            from public.deadline_confirmations c
            left join public.profiles p on p.id::text = c.confirmer_id
           where c.deadline_id = d.id and c.confirmer_id <> me.id
             and not coalesce(p.banned_until > now(), false)),
         d.submitted_at
    from public.module_deadlines d, me
   where d.submitter_id = me.id
     and d.submitted_at > now() - interval '14 days'
     and d.status <> 'rejected'
     and (d.status = 'verified'
          or (select count(*) from public.deadline_confirmations c
               where c.deadline_id = d.id and c.confirmer_id <> me.id) >= 2);
$$;

revoke all    on function public.my_recent_contributions() from public, anon;
grant execute on function public.my_recent_contributions() to authenticated;
