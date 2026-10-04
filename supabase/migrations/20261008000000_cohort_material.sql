-- Shared teaching and per-cohort session material.
--
-- * Each segment has a standard transcript (the written form of the standard video), shown on the Watch tab.
-- * Each cohort has its own session material per segment: what was said ('talk'), songs ('song'),
--   table discussions ('table') and prayers ('prayers'), shown on the Read tab.
-- * Each cohort has a sharing limit (everyone by default, or its church, or just the cohort), set by
--   admins or that church's church admins. It limits who can see the cohort's session material, and
--   caps its members' notes: people still choose each note's visibility, but never beyond the limit.
-- * Notes for everyone still need approval before other churches see them; church admins can now
--   approve their own church's notes (without seeing who wrote them).

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.segments add column transcript text not null default '';
update public.segments set transcript = body;

alter table public.cohorts
  add column share_limit text not null default 'everyone' check (share_limit in ('everyone', 'church', 'cohort'));

alter table public.contributions drop constraint contributions_kind_check;
alter table public.contributions
  add constraint contributions_kind_check check (kind in ('talk', 'song', 'table', 'prayers')),
  add column url         text,   -- songs: the video link
  add column language    text,   -- songs
  add column translation text;   -- songs: the title in English
alter table public.contributions alter column body set default '';
-- Who sees a contribution now follows its cohort's share_limit (the policy using shared_with goes first).
drop policy "members read own cohort or shared contributions" on public.contributions;
alter table public.contributions drop column shared_with;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Fix: for someone who administers no church this used to return NULL rather than false, and
-- "if not can_manage_church(...)" never refused them (NOT NULL is NULL). That let any member approve or
-- decline join requests if they knew the request's id. Always return true or false.
create or replace function public.can_manage_church(p_church text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or coalesce(public.my_admin_church() = p_church, false);
$$;

-- The narrower of two visibility levels (me < cohort < church < everyone).
create function public.narrower(a text, b text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when array_position(array['me', 'cohort', 'church', 'everyone'], a)
                <= array_position(array['me', 'cohort', 'church', 'everyone'], b) then a else b end;
$$;

-- Can the signed-in member see something from this church/cohort shared at this level?
-- (Cross-church approval for notes is checked separately.)
create function public.visible_to_me(p_church text, p_cohort text, p_level text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.my_cohort() is not null and (
       p_cohort = public.my_cohort()
    or (p_level = 'church'   and p_church = public.my_church())
    or  p_level = 'everyone'
  );
$$;

-- ---------------------------------------------------------------------------
-- Session material (Read tab)
-- ---------------------------------------------------------------------------

create policy "members read session material they may see" on public.contributions
  for select to authenticated
  using (
    (select public.is_admin())
    or (exists (select 1 from public.cohorts c
                where c.id = contributions.cohort and public.visible_to_me(c.church, c.id, c.share_limit))
        and exists (select 1 from public.segments g join public.sessions s on s.id = g.session
                    where g.id = contributions.segment and s.published_at is not null))
  );

-- A segment's session material that I may see, with the cohort it came from.
-- p_scope: 'cohort' (default: my cohort), 'church' (my church) or 'all'. My cohort comes first.
create function public.session_material(p_segment text, p_scope text default 'cohort')
returns table (id uuid, cohort text, cohort_name text, church_name text, mine boolean, kind text, item_position int,
               title text, body text, url text, language text, translation text)
language sql
stable
security definer
set search_path = ''
as $$
  select x.id, c.id, c.name, ch.name, c.id = public.my_cohort(), x.kind, x.position,
         x.title, x.body, x.url, x.language, x.translation
  from public.contributions x
  join public.cohorts c on c.id = x.cohort
  join public.churches ch on ch.id = c.church
  join public.segments g on g.id = x.segment
  join public.sessions s on s.id = g.session
  where x.segment = p_segment
    and (s.published_at is not null or public.is_admin())
    and public.visible_to_me(c.church, c.id, c.share_limit)
    and case p_scope
          when 'cohort' then c.id = public.my_cohort()
          when 'church' then c.church = public.my_church()
          else true
        end
  order by c.id = public.my_cohort() desc, ch.name, c.name,
           array_position(array['talk', 'song', 'table', 'prayers'], x.kind), x.position;
$$;

-- ---------------------------------------------------------------------------
-- Notes: capped by the writer's cohort limit
-- ---------------------------------------------------------------------------

create or replace function public.notes_for_segment(p_segment text, p_scope text default 'cohort')
returns table (id uuid, body text, updated_at timestamptz, mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.body, n.updated_at, n.user_id = auth.uid()
  from public.notes n
  join public.cohorts c on c.id = n.cohort
  cross join lateral (select public.narrower(n.visibility, c.share_limit) as level) v
  where n.segment = p_segment
    and n.body <> ''
    and public.my_cohort() is not null
    and (
         n.user_id = auth.uid()
      or (v.level = 'cohort'   and n.cohort = public.my_cohort())
      or (v.level = 'church'   and n.church = public.my_church())
      or (v.level = 'everyone' and (n.church = public.my_church() or n.approved_at is not null))
    )
    and case p_scope
          when 'mine'   then n.user_id = auth.uid()
          when 'cohort' then n.cohort = public.my_cohort()
          when 'church' then n.church = public.my_church()
          else true
        end
  order by n.updated_at desc;
$$;

-- Admins see every shared note with its writer; church admins see their church's, without the writer.
-- 'visibility' is the effective level (after the cohort's limit).
drop function public.admin_shared_notes();
create function public.admin_shared_notes()
returns table (id uuid, segment text, segment_title text, body text, visibility text, approved_at timestamptz,
               updated_at timestamptz, author text, email text, church text, cohort text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or public.my_admin_church() is not null) then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select n.id, n.segment, g.title, n.body, public.narrower(n.visibility, k.share_limit), n.approved_at, n.updated_at,
           case when public.is_admin() then trim(coalesce(p.given_name, '') || ' ' || coalesce(p.family_name, '')) end,
           case when public.is_admin() then p.email end,
           c.name, k.name
    from public.notes n
    join public.segments g on g.id = n.segment
    join public.profiles p on p.id = n.user_id
    join public.churches c on c.id = n.church
    join public.cohorts k on k.id = n.cohort
    where public.narrower(n.visibility, k.share_limit) <> 'me' and n.body <> ''
      and public.can_manage_church(n.church)
    order by (public.narrower(n.visibility, k.share_limit) = 'everyone' and n.approved_at is null) desc, n.updated_at desc;
end;
$$;

create or replace function public.set_note_approval(p_id uuid, p_approved boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ch text := (select church from public.notes where id = p_id);
begin
  if ch is null or not public.can_manage_church(ch) then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  -- The trigger only withdraws approval when the text or visibility changes, so this sticks.
  update public.notes set approved_at = case when p_approved then now() end
   where id = p_id and visibility = 'everyone';
end;
$$;

-- ---------------------------------------------------------------------------
-- Setting a cohort's sharing limit (admins, or its church's church admins)
-- ---------------------------------------------------------------------------

create function public.set_cohort_share_limit(p_cohort text, p_limit text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ch text := (select church from public.cohorts where id = p_cohort);
begin
  if ch is null or not public.can_manage_church(ch) then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  update public.cohorts set share_limit = p_limit where id = p_cohort;
end;
$$;

revoke execute on function public.narrower(text, text)                    from public, anon;
grant  execute on function public.narrower(text, text)                    to authenticated;
revoke execute on function public.visible_to_me(text, text, text)         from public, anon;
grant  execute on function public.visible_to_me(text, text, text)         to authenticated;
revoke execute on function public.session_material(text, text)            from public, anon;
grant  execute on function public.session_material(text, text)            to authenticated;
revoke execute on function public.admin_shared_notes()                    from public, anon;
grant  execute on function public.admin_shared_notes()                    to authenticated;
revoke execute on function public.set_cohort_share_limit(text, text)      from public, anon;
grant  execute on function public.set_cohort_share_limit(text, text)      to authenticated;
