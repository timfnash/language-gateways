-- Phase 3: notes can be shared, without names.
--
-- Each note has a visibility: everyone (the default), church, cohort or me.
--   * "everyone" notes are seen by the writer's own church straight away, and by other churches
--     once an admin approves them. Editing a note withdraws the approval.
--   * Shared notes are always shown without a name or church. Only admins can see who wrote a shared
--     note (and their church), through admin_shared_notes(). Nobody but the writer sees "me" notes.
-- The notes table itself stays readable only by its writer; other people's notes are read through
-- notes_for_segment(), which returns no author details.

alter table public.notes
  add column id          uuid not null default gen_random_uuid() unique,
  add column visibility  text not null default 'everyone' check (visibility in ('everyone', 'church', 'cohort', 'me')),
  add column church      text,
  add column cohort      text,
  add column approved_at timestamptz;

-- Notes written before sharing existed were promised to be private.
update public.notes n
   set visibility = 'me', church = p.church, cohort = p.cohort
  from public.profiles p
 where p.id = n.user_id;

alter table public.notes
  alter column church set not null,
  alter column cohort set not null;

create index notes_segment_idx on public.notes (segment, visibility);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.my_church()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select church from public.profiles where id = auth.uid();
$$;

-- Church and cohort always come from the writer's profile; a changed note loses its approval.
create function public.note_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select church, cohort into new.church, new.cohort from public.profiles where id = new.user_id;
  if new.church is null then
    raise exception 'Only course members can write notes.' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and (new.body is distinct from old.body or new.visibility is distinct from old.visibility) then
    new.approved_at := null;
  end if;
  return new;
end;
$$;

create trigger notes_defaults
  before insert or update on public.notes
  for each row execute function public.note_defaults();

-- ---------------------------------------------------------------------------
-- What members call
-- ---------------------------------------------------------------------------

-- Save (create or update) my note on a segment.
create function public.save_note(p_segment text, p_body text, p_visibility text default 'everyone')
returns public.notes
language sql
security definer
set search_path = ''
as $$
  insert into public.notes as n (user_id, segment, body, visibility)
  values (auth.uid(), p_segment, coalesce(p_body, ''), p_visibility)
  on conflict (user_id, segment) do update
    set body = excluded.body, visibility = excluded.visibility
  returning *;
$$;

-- Notes on a segment that I'm allowed to see, newest first, without author details.
-- p_scope narrows them: 'all' (default), 'church', 'cohort' or 'mine'.
create function public.notes_for_segment(p_segment text, p_scope text default 'all')
returns table (id uuid, body text, updated_at timestamptz, mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.body, n.updated_at, n.user_id = auth.uid()
  from public.notes n
  where n.segment = p_segment
    and n.body <> ''
    and public.my_cohort() is not null
    and (
         n.user_id = auth.uid()
      or (n.visibility = 'cohort'   and n.cohort = public.my_cohort())
      or (n.visibility = 'church'   and n.church = public.my_church())
      or (n.visibility = 'everyone' and (n.church = public.my_church() or n.approved_at is not null))
    )
    and case p_scope
          when 'mine'   then n.user_id = auth.uid()
          when 'cohort' then n.cohort = public.my_cohort()
          when 'church' then n.church = public.my_church()
          else true
        end
  order by n.updated_at desc;
$$;

-- ---------------------------------------------------------------------------
-- What admins call
-- ---------------------------------------------------------------------------

-- Every shared note with its writer, for moderation and approval. "Only me" notes are never included.
create function public.admin_shared_notes()
returns table (id uuid, segment text, segment_title text, body text, visibility text, approved_at timestamptz,
               updated_at timestamptz, author text, email text, church text, cohort text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select n.id, n.segment, g.title, n.body, n.visibility, n.approved_at, n.updated_at,
           trim(coalesce(p.given_name, '') || ' ' || coalesce(p.family_name, '')), p.email, c.name, k.name
    from public.notes n
    join public.segments g on g.id = n.segment
    join public.profiles p on p.id = n.user_id
    join public.churches c on c.id = n.church
    join public.cohorts k on k.id = n.cohort
    where n.visibility <> 'me' and n.body <> ''
    order by (n.visibility = 'everyone' and n.approved_at is null) desc, n.updated_at desc;
end;
$$;

-- Approve (or withdraw approval of) an "everyone" note for other churches.
create function public.set_note_approval(p_id uuid, p_approved boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  -- The trigger only withdraws approval when the text or visibility changes, so this sticks.
  update public.notes set approved_at = case when p_approved then now() end
   where id = p_id and visibility = 'everyone';
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions: members change notes only through save_note (and may delete their own)
-- ---------------------------------------------------------------------------

drop policy "write own notes" on public.notes;
drop policy "edit own notes" on public.notes;
revoke insert, update on public.notes from anon, authenticated;

revoke execute on function public.my_church()                        from public, anon;
grant  execute on function public.my_church()                        to authenticated;
revoke execute on function public.note_defaults()                    from public, anon, authenticated;
revoke execute on function public.save_note(text, text, text)        from public, anon;
grant  execute on function public.save_note(text, text, text)        to authenticated;
revoke execute on function public.notes_for_segment(text, text)      from public, anon;
grant  execute on function public.notes_for_segment(text, text)      to authenticated;
revoke execute on function public.admin_shared_notes()               from public, anon;
grant  execute on function public.admin_shared_notes()               to authenticated;
revoke execute on function public.set_note_approval(uuid, boolean)   from public, anon;
grant  execute on function public.set_note_approval(uuid, boolean)   to authenticated;
