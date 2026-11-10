-- ---------------------------------------------------------------------------
-- Phase 51 — a poster deleting their own deadline goes through an RPC
-- ---------------------------------------------------------------------------
--
-- RUN ORDER: phase25_deadlines.sql → THIS FILE. Independent of phases 45–50.
--
-- "Delete deadline" in the app did nothing. It sent
--   DELETE /rest/v1/module_deadlines?id=eq.<id>&submitter_id=eq.<me>
-- and "delete own" (phase 6) allows that row. But a DELETE whose WHERE reads columns is also
-- held to the table's SELECT policies, and since phase 3 the only one is "read admin":
-- students read module_deadlines_public, never the base table. So the row was invisible to
-- the DELETE, it matched nothing, PostgREST answered 204, and the reload put the card back.
-- Checked on the live project 10 Nov 2026 in a rolled-back transaction: 0 rows deleted.
--
-- Opening SELECT on the base table would hand every student every submitter_id, which is
-- what phase 3 closed. So, as with edit_deadline, the check moves into a security-definer
-- function and the client calls that.
--
-- A rejected deadline is kept so a repeat of the same wrong date is recognised (phase 3),
-- and the poster can't see it anyway, so it isn't theirs to delete. Confirmations, reports,
-- labels and details history go with the row (ON DELETE CASCADE on each).
--
-- Safe to re-run. Run it in the Supabase SQL editor.

create or replace function public.withdraw_deadline(p_deadline uuid)
  returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;

  delete from public.module_deadlines
   where id = p_deadline
     and submitter_id = auth.uid()::text
     and status <> 'rejected';
  if not found then raise exception 'no such deadline of yours'; end if;
end $$;

revoke all on function public.withdraw_deadline(uuid) from public, anon;
grant execute on function public.withdraw_deadline(uuid) to authenticated;

-- "delete own" stays: nothing calls it now, and it only ever allowed what this does.

-- ---------------------------------------------------------------------------
-- Check it
-- ---------------------------------------------------------------------------
--
-- As a student (in a rolled-back transaction), with <id> one of their own deadlines:
--
--   begin;
--   select set_config('request.jwt.claims', '{"sub":"<their uid>","role":"authenticated"}', true);
--   set local role authenticated;
--   select public.withdraw_deadline('<id>');                  -- returns, no error
--   select count(*) from module_deadlines_public where id = '<id>';   -- 0
--   select public.withdraw_deadline('<someone else''s id>');  -- ERROR: no such deadline of yours
--   rollback;
