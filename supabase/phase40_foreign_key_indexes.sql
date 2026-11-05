-- ---------------------------------------------------------------------------
-- Phase 40 — an index under every foreign key
-- ---------------------------------------------------------------------------
--
-- Postgres indexes the referenced side of a foreign key (it's a primary key), never the
-- referencing side. So deleting a row that others point at has to read the whole of each
-- table that points at it: deleting an account reads all of deadline_reports,
-- admin_actions and the rest to find (and cascade, null or refuse) its rows, and deleting
-- a push subscription — which the app and send-pushes now do for one made with an old key
-- — reads all of push_outbox.
--
-- Every table here is small today, so none of this is slow yet. These are the 16 the
-- Supabase advisor lists as "Unindexed foreign keys", and an index on a small table costs
-- next to nothing.
--
-- RUN ORDER: any time after phase 39. Safe to re-run. Run it in the Supabase SQL editor.

-- Accounts (auth.users or profiles): read when an account is deleted.
create index if not exists admin_actions_actor_id_idx               on public.admin_actions (actor_id);
create index if not exists allocation_flags_user_id_idx             on public.allocation_flags (user_id);
create index if not exists deadline_details_history_replaced_by_idx on public.deadline_details_history (replaced_by);
create index if not exists deadline_details_history_written_by_idx  on public.deadline_details_history (written_by);
create index if not exists deadline_reports_reporter_id_idx         on public.deadline_reports (reporter_id);
create index if not exists deadline_reports_resolved_by_idx         on public.deadline_reports (resolved_by);
create index if not exists event_verdicts_decided_by_idx            on public.event_verdicts (decided_by);
create index if not exists lab_rotations_created_by_idx             on public.lab_rotations (created_by);
create index if not exists module_deadlines_details_edited_by_idx   on public.module_deadlines (details_edited_by);
create index if not exists module_deadlines_verified_by_idx         on public.module_deadlines (verified_by);
create index if not exists module_splits_created_by_idx             on public.module_splits (created_by);
create index if not exists module_titles_updated_by_idx             on public.module_titles (updated_by);
create index if not exists rosters_created_by_idx                   on public.rosters (created_by);
create index if not exists timetable_changes_created_by_idx         on public.timetable_changes (created_by);

-- Other rows: read when a deadline or a push subscription is deleted.
create index if not exists deadline_labels_deadline_id_idx          on public.deadline_labels (deadline_id);
create index if not exists push_outbox_subscription_id_idx          on public.push_outbox (subscription_id);
