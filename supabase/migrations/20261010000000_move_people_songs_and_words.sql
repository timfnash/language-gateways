-- Moving people between cohorts, and the course-wide Songs and Words pages.
--
-- * Admins can move a person (invited, joined or waiting for approval) to another cohort, in the same church or
--   another. Their invitation, profile and notes move with them; a church admin who moves to another church
--   loses that role (they can be given it again for the new church).
-- * course_songs(): every song the signed-in member may see, from every published session, for the Songs page.
-- * perspectives: words seen through different languages ("sin" as missing the target in Hebrew and Greek, as
--   uncleanness in Japanese, …), from the shared teaching (no cohort) or a cohort's discussions. Loaded from
--   perspectives.csv by pipeline/load_session.py. A cohort's perspectives follow its sharing limit, like its songs
--   and table discussions; the teaching's are seen by every member.

-- ---------------------------------------------------------------------------
-- Moving a person to another cohort (admins only)
-- ---------------------------------------------------------------------------

create function public.admin_move_person(p_email text, p_cohort text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  e   text := lower(trim(p_email));
  c   public.cohorts;
  uid uuid;
  result text := 'moved';
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from public.cohorts where id = p_cohort;
  if c.id is null then
    raise exception 'No such cohort.';
  end if;
  select id into uid from public.profiles where email = e;
  if uid is null and not exists (select 1 from public.invitations where email = e) then
    raise exception 'No such person.';
  end if;

  update public.invitations set church = c.church, cohort = c.id where email = e;
  update public.profiles set church = c.church, cohort = c.id where id = uid;
  -- Notes belong to the writer's cohort (the notes trigger restamps church and cohort from the profile).
  update public.notes set church = c.church, cohort = c.id where user_id = uid;

  delete from public.church_admins where email = e and church <> c.church;
  if found then result := 'moved, no longer church admin'; end if;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Songs page
-- ---------------------------------------------------------------------------

-- Every song I may see: my own cohort's, and other cohorts' within their sharing limits. In session order.
create function public.course_songs()
returns table (id uuid, title text, translation text, language text, url text, story text,
               cohort text, cohort_name text, church text, church_name text, mine boolean,
               session_number int, session_title text, segment text, item_position int)
language sql
stable
security definer
set search_path = ''
as $$
  select x.id, x.title, x.translation, x.language, x.url, x.body,
         c.id, c.name, ch.id, ch.name, c.id = public.my_cohort(),
         s.number, s.title, g.id, x.position
  from public.contributions x
  join public.cohorts c on c.id = x.cohort
  join public.churches ch on ch.id = c.church
  join public.segments g on g.id = x.segment
  join public.sessions s on s.id = g.session
  where x.kind = 'song'
    and (s.published_at is not null or public.is_admin())
    and (c.id = public.my_cohort() or public.visible_to_me(c.church, c.id, c.share_limit))
  order by s.number, g.position, c.id = public.my_cohort() desc, ch.name, c.name, x.position;
$$;

-- ---------------------------------------------------------------------------
-- Words seen through different languages
-- ---------------------------------------------------------------------------

create table public.perspectives (
  id           uuid primary key default gen_random_uuid(),
  segment      text not null references public.segments (id) on update cascade on delete cascade,
  cohort       text references public.cohorts (id) on update cascade,  -- null = from the shared teaching
  position     int  not null default 1,
  concept      text not null,     -- the word being looked at, in English, e.g. "sin"
  language     text not null,
  term         text not null,     -- the word in that language, e.g. 罪 or hara
  romanisation text,              -- pronunciation or romanisation, where it helps
  insight      text not null default '',  -- Markdown: what this language shows us
  created_at   timestamptz not null default now()
);
create index perspectives_segment_idx on public.perspectives (segment, cohort);
alter table public.perspectives enable row level security;

create policy "admins manage perspectives" on public.perspectives
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "members read perspectives they may see" on public.perspectives
  for select to authenticated
  using (
    (select public.is_admin())
    or (exists (select 1 from public.segments g join public.sessions s on s.id = g.session
                where g.id = perspectives.segment and s.published_at is not null)
        and (case when perspectives.cohort is null then (select public.my_cohort()) is not null
                  else exists (select 1 from public.cohorts c
                               where c.id = perspectives.cohort
                                 and (c.id = public.my_cohort() or public.visible_to_me(c.church, c.id, c.share_limit)))
             end))
  );

-- Every perspective I may see, with where it came from (cohort and church are null for the shared teaching).
create function public.course_perspectives()
returns table (id uuid, concept text, language text, term text, romanisation text, insight text,
               cohort text, cohort_name text, church_name text, mine boolean,
               session_number int, session_title text, segment text, segment_title text)
language sql
stable
security definer
set search_path = ''
as $$
  select x.id, x.concept, x.language, x.term, x.romanisation, x.insight,
         c.id, c.name, ch.name, coalesce(c.id = public.my_cohort(), false),
         s.number, s.title, g.id, g.title
  from public.perspectives x
  left join public.cohorts c on c.id = x.cohort
  left join public.churches ch on ch.id = c.church
  join public.segments g on g.id = x.segment
  join public.sessions s on s.id = g.session
  where (s.published_at is not null or public.is_admin())
    and public.my_cohort() is not null
    and (x.cohort is null or c.id = public.my_cohort() or public.visible_to_me(c.church, c.id, c.share_limit))
  order by lower(x.concept), s.number, g.position, x.cohort is not null, ch.name, c.name, x.position;
$$;

revoke execute on function public.admin_move_person(text, text) from public, anon;
grant  execute on function public.admin_move_person(text, text) to authenticated;
revoke execute on function public.course_songs()                 from public, anon;
grant  execute on function public.course_songs()                 to authenticated;
revoke execute on function public.course_perspectives()          from public, anon;
grant  execute on function public.course_perspectives()          to authenticated;
