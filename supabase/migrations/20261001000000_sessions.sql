-- Phase 1: course content and progress.
--
-- Course → Session → Segment. A segment has a write-up (Markdown), slide images in the private
-- course-media bucket, and a slice of the session's YouTube video.
-- Table write-ups and prayers are contributions: they belong to a segment AND a cohort, so one
-- church's discussions aren't shown to another church unless Tim shares them.
-- Progress records, per person, which segments they have read, watched or clicked through.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.courses (
  id         text primary key check (id ~ '^[a-z0-9-]+$'),  -- e.g. fid
  title      text not null,
  created_at timestamptz not null default now()
);

create table public.sessions (
  id           text primary key check (id ~ '^[a-z0-9-]+$'),  -- e.g. fid-1
  course       text not null references public.courses (id) on update cascade,
  number       int  not null check (number > 0),
  title        text not null,
  summary      text,
  youtube_id   text,           -- the whole session's video; segments give start and end times
  published_at timestamptz,    -- null = only admins can see it
  created_at   timestamptz not null default now(),
  unique (course, number)
);

create table public.segments (
  id            text primary key check (id ~ '^[a-z0-9-]+$'),  -- e.g. fid-1-2
  session       text not null references public.sessions (id) on update cascade on delete cascade,
  position      int  not null check (position > 0),
  title         text not null,
  summary       text,
  body          text not null default '',  -- Markdown; ![caption](slide:3) places slide 3
  slides        text[] not null default '{}',  -- paths in the course-media bucket, in order
  youtube_start int check (youtube_start >= 0),  -- seconds
  youtube_end   int check (youtube_end > youtube_start),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (session, position)
);

create table public.contributions (
  id          uuid primary key default gen_random_uuid(),
  segment     text not null references public.segments (id) on update cascade on delete cascade,
  cohort      text not null references public.cohorts (id) on update cascade,
  kind        text not null check (kind in ('table', 'prayers')),
  position    int  not null default 1,
  title       text not null,           -- e.g. "Table 3"
  body        text not null,           -- Markdown
  shared_with text not null default 'cohort' check (shared_with in ('cohort', 'everyone')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index contributions_segment_idx on public.contributions (segment, cohort);

create table public.progress (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  segment      text not null references public.segments (id) on update cascade on delete cascade,
  mode         text not null check (mode in ('read', 'watch', 'slides', 'listen')),
  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, segment, mode)
);
create index progress_user_updated_idx on public.progress (user_id, updated_at desc);

create trigger segments_touch_updated_at
  before update on public.segments
  for each row execute function public.touch_updated_at();

create trigger contributions_touch_updated_at
  before update on public.contributions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The signed-in person's cohort (null if they have no profile).
create function public.my_cohort()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select cohort from public.profiles where id = auth.uid();
$$;

-- Records that the signed-in person has opened (or finished) a segment in a given mode.
-- Completion is kept once set, and "updated_at" drives "continue where you left off".
create function public.record_progress(p_segment text, p_mode text, p_completed boolean default false)
returns public.progress
language sql
security invoker
set search_path = ''
as $$
  insert into public.progress as p (user_id, segment, mode, completed_at)
  values (auth.uid(), p_segment, p_mode, case when p_completed then now() end)
  on conflict (user_id, segment, mode) do update
    set updated_at   = now(),
        completed_at = coalesce(p.completed_at, excluded.completed_at)
  returning *;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.courses       enable row level security;
alter table public.sessions      enable row level security;
alter table public.segments      enable row level security;
alter table public.contributions enable row level security;
alter table public.progress      enable row level security;

-- Content is for invited people (anyone with a profile); unpublished sessions are admin-only.
create policy "members read courses" on public.courses
  for select to authenticated
  using ((select public.my_cohort()) is not null or (select public.is_admin()));
create policy "admins manage courses" on public.courses
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "members read published sessions" on public.sessions
  for select to authenticated
  using (((select public.my_cohort()) is not null and published_at is not null) or (select public.is_admin()));
create policy "admins manage sessions" on public.sessions
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "members read segments of published sessions" on public.segments
  for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.my_cohort()) is not null
        and exists (select 1 from public.sessions s where s.id = segments.session and s.published_at is not null))
  );
create policy "admins manage segments" on public.segments
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Contributions: your own cohort's, plus anything Tim has shared with everyone.
create policy "members read own cohort or shared contributions" on public.contributions
  for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.my_cohort()) is not null
        and (cohort = (select public.my_cohort()) or shared_with = 'everyone')
        and exists (select 1 from public.segments g join public.sessions s on s.id = g.session
                    where g.id = contributions.segment and s.published_at is not null))
  );
create policy "admins manage contributions" on public.contributions
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Progress: people read and write only their own; admins can read everyone's.
create policy "read own progress" on public.progress
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "insert own progress" on public.progress
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "update own progress" on public.progress
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke execute on function public.my_cohort() from public, anon;
grant  execute on function public.my_cohort() to authenticated;
revoke execute on function public.record_progress(text, text, boolean) from public, anon;
grant  execute on function public.record_progress(text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: slide images and other media, private to invited people
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('course-media', 'course-media', false)
on conflict (id) do nothing;

create policy "members read course media" on storage.objects
  for select to authenticated
  using (bucket_id = 'course-media'
         and ((select public.my_cohort()) is not null or (select public.is_admin())));
create policy "admins manage course media" on storage.objects
  for all to authenticated
  using (bucket_id = 'course-media' and (select public.is_admin()))
  with check (bucket_id = 'course-media' and (select public.is_admin()));
