-- ---------------------------------------------------------------------------
-- Phase 28 — what each module is called on the app's week grid
-- ---------------------------------------------------------------------------
--
-- A week-grid block on a phone fits about 10 characters a line, and DCU's "EEG1000[1,2]
-- Fundamentals of Professional Development" doesn't. The console's Abbreviations page sets
-- a short name per module, typed by hand or suggested in bulk by the assistant and saved
-- after a look. A module with no row shows DCU's name, shortened by the app.
--
--   abbreviation  what the week grid shows. Null while a module is only flagged.
--   source        'manual' when a person typed or picked it, 'ai' when it was saved from
--                 the assistant's suggestions. The assistant never replaces a manual one.
--   flag          why a person should look, when the assistant couldn't abbreviate a
--                 module well. For the console only; the app doesn't read it.
--   suggestion    the assistant's best guess for a flagged module, not shown to students.
--
-- By module, not course, as module_splits: a module is called the same whoever takes it.
-- Nothing here is personal data, so every signed-in student reads it; there's no record of
-- who set what here, since admin_actions has that.
--
-- Written only through save_module_abbreviations, which checks the caller is an admin and
-- audits each module it changes. There's no write policy, so there is no other way in.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

create table if not exists module_abbreviations (
  module_key   text primary key check (module_key ~ '^[A-Z]{2,5}[0-9]{2,5}[A-Z]?$'),
  -- 20 is what a one-hour block shows (web/src/lib/abbreviations/check.ts).
  abbreviation text check (abbreviation is null
                           or (abbreviation = btrim(abbreviation) and length(abbreviation) between 1 and 20)),
  source       text check (source in ('manual', 'ai')),
  flag         text check (flag is null or length(btrim(flag)) between 1 and 300),
  suggestion   text check (suggestion is null or length(btrim(suggestion)) between 1 and 80),
  updated_at   timestamptz not null default now(),
  -- A row is an abbreviation, a flag, or both; an empty one is no row at all.
  check (abbreviation is not null or flag is not null),
  check ((abbreviation is null) = (source is null))
);

alter table module_abbreviations enable row level security;
revoke all    on table module_abbreviations from public, anon, authenticated;
grant  select on table module_abbreviations to authenticated;

drop policy if exists "read signed in" on module_abbreviations;
create policy "read signed in" on module_abbreviations
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Saving
-- ---------------------------------------------------------------------------
--
-- Several modules at once, all or none: a batch of suggestions is saved in one go, and half
-- of one saved would leave the page and the app out of step. Each element is
-- {module_key, abbreviation, source, flag, suggestion}; one with neither an abbreviation
-- nor a flag deletes the module's row, which puts DCU's name back. A module whose row
-- wouldn't change is skipped, and gets no audit row. Returns how many changed.

create or replace function public.save_module_abbreviations(p_rows jsonb) returns int
  language plpgsql security definer set search_path = '' as $$
declare
  r        jsonb;
  key      text;
  old_row  jsonb;
  new_row  jsonb;
  changed  int := 0;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'expected a list of at most 500 modules';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    key := r->>'module_key';
    select jsonb_build_object('abbreviation', a.abbreviation, 'source', a.source,
                              'flag', a.flag, 'suggestion', a.suggestion)
      into old_row
      from public.module_abbreviations a where a.module_key = key;
    new_row := jsonb_build_object(
      'abbreviation', nullif(btrim(r->>'abbreviation'), ''),
      'source',       case when nullif(btrim(r->>'abbreviation'), '') is null then null else r->>'source' end,
      'flag',         nullif(btrim(r->>'flag'), ''),
      'suggestion',   nullif(btrim(r->>'suggestion'), ''));

    if new_row->>'abbreviation' is null and new_row->>'flag' is null then
      if old_row is null then continue; end if;
      delete from public.module_abbreviations where module_key = key;
      new_row := null;
    else
      if old_row = new_row then continue; end if;
      insert into public.module_abbreviations (module_key, abbreviation, source, flag, suggestion, updated_at)
      values (key, new_row->>'abbreviation', new_row->>'source', new_row->>'flag', new_row->>'suggestion', now())
      on conflict (module_key) do update
        set abbreviation = excluded.abbreviation, source = excluded.source, flag = excluded.flag,
            suggestion = excluded.suggestion, updated_at = excluded.updated_at;
    end if;

    insert into public.admin_actions (actor_id, action, target, before, after)
    values (auth.uid(), 'abbreviation.save', key, old_row, new_row);
    changed := changed + 1;
  end loop;
  return changed;
end $$;

-- ---------------------------------------------------------------------------
-- Grants — restated, as in every phase since 8
-- ---------------------------------------------------------------------------

revoke all    on function public.save_module_abbreviations(jsonb) from public, anon;
grant execute on function public.save_module_abbreviations(jsonb) to authenticated;
