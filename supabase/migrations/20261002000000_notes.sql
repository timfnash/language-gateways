-- Phase 2: personal notes. One private note per person per segment.
-- Notes are visible only to the person who wrote them: not to their church, and not to admins.
-- (Sharing comes in Phase 3, as comments.)

create table public.notes (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  segment    text not null references public.segments (id) on update cascade on delete cascade,
  body       text not null default '' check (length(body) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, segment)
);

create trigger notes_touch_updated_at
  before update on public.notes
  for each row execute function public.touch_updated_at();

alter table public.notes enable row level security;

create policy "read own notes" on public.notes
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "write own notes" on public.notes
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "edit own notes" on public.notes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "delete own notes" on public.notes
  for delete to authenticated
  using (user_id = (select auth.uid()));
