-- ---------------------------------------------------------------------------
-- Phase 27 — class headings
-- ---------------------------------------------------------------------------
--
-- DCU names a module "EEG1000[1,2] Fundamentals of Professional Development". The app drops
-- the code and shortens long words for the week grid, but some names still read badly on a
-- phone, and only a person can say what a module is actually called. This holds the heading
-- an administrator chose, from Ask in the console.
--
-- `title` is what the day view, the widget and the deadlines list show. `short_title`, when
-- set, is what the narrow week-grid block shows instead of a shortened `title`. The class's
-- own page keeps DCU's full name and code.
--
-- By module, not course: the heading is the module's, whoever takes it. Nothing here is
-- personal data, so every signed-in student reads it, like `module_splits`.
--
-- Written only through the two definer functions below, as the other Ask saves are: one
-- admin check and one audit row each. No write policy, so there is no other way in.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

create table if not exists module_titles (
  module_key  text primary key,
  title       text not null check (length(btrim(title)) between 1 and 80),
  short_title text check (short_title is null or length(btrim(short_title)) between 1 and 30),
  updated_by  uuid references auth.users (id),
  updated_at  timestamptz not null default now()
);

alter table module_titles enable row level security;

-- Readable by everyone signed in: a heading is public timetable information, and the app has
-- to read it to show it.
drop policy if exists "read signed in" on module_titles;
create policy "read signed in" on module_titles
  for select to authenticated using (true);

revoke insert, update, delete on table module_titles from public, anon, authenticated;

create or replace function public.save_module_title(p_module_key text, p_title text, p_short_title text)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  old_row jsonb;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;

  select jsonb_build_object('title', title, 'short_title', short_title) into old_row
    from public.module_titles where module_key = p_module_key;

  insert into public.module_titles (module_key, title, short_title, updated_by, updated_at)
  values (p_module_key, btrim(p_title), nullif(btrim(p_short_title), ''), auth.uid(), now())
  on conflict (module_key) do update
    set title = excluded.title, short_title = excluded.short_title,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'title.save', p_module_key, old_row,
          jsonb_build_object('title', btrim(p_title), 'short_title', nullif(btrim(p_short_title), '')));
end $$;

create or replace function public.delete_module_title(p_module_key text)
  returns boolean language plpgsql security definer set search_path = '' as $$
declare
  old_row jsonb;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;

  delete from public.module_titles where module_key = p_module_key
  returning jsonb_build_object('title', title, 'short_title', short_title) into old_row;
  if not found then return false; end if;

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'title.delete', p_module_key, old_row, null);
  return true;
end $$;

revoke all    on function public.save_module_title(text, text, text) from public, anon;
revoke all    on function public.delete_module_title(text)           from public, anon;
grant execute on function public.save_module_title(text, text, text) to authenticated, service_role;
grant execute on function public.delete_module_title(text)           to authenticated, service_role;
