-- Phase 0 foundations: churches, cohorts, invitations, admins, profiles.
--
-- Access is invitation-only. Signup is rejected unless the email is in public.invitations,
-- enforced twice on the server:
--   1. public.hook_before_user_created — a "Before User Created" auth hook (enable it in
--      Authentication → Hooks). Gives the user a clear error message.
--   2. public.enforce_invitation — a trigger on auth.users, so the rule still holds if the
--      hook is ever switched off.
-- Every table has row-level security (RLS) on.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.churches (
  id         text primary key check (id ~ '^[a-z0-9-]+$'),  -- e.g. freedom-church-jersey
  name       text not null,
  created_at timestamptz not null default now()
);

-- One run of the course at a church.
create table public.cohorts (
  id         text primary key check (id ~ '^[a-z0-9-]+$'),  -- e.g. freedom-church-jersey-2026-09
  church     text not null references public.churches (id) on update cascade,
  name       text not null,
  starts_on  date,
  created_at timestamptz not null default now(),
  unique (church, id)
);

-- Columns are named to match the CSV Tim imports (see docs/INVITATIONS.md).
create table public.invitations (
  email           text primary key,
  church          text not null,
  cohort          text not null,
  given_name      text,
  family_name     text,
  mother_tongue   text,
  other_languages text,
  created_at      timestamptz not null default now(),
  foreign key (church, cohort) references public.cohorts (church, id) on update cascade
);

-- Admins are listed by email so Tim can be made an admin before he signs up.
-- No RLS policies: only the dashboard (service role) can read or change this table.
create table public.admins (
  email      text primary key,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  email           text not null,
  church          text not null,
  cohort          text not null,
  given_name      text,
  family_name     text,
  mother_tongue   text,
  other_languages text,
  confirmed_at    timestamptz,  -- set when the user first saves their profile
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (church, cohort) references public.cohorts (church, id) on update cascade
);

-- ---------------------------------------------------------------------------
-- Housekeeping triggers
-- ---------------------------------------------------------------------------

-- Emails are stored lower-case and trimmed, so CSV imports match whatever case people sign up with.
create function public.normalise_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(trim(new.email));
  return new;
end;
$$;

create trigger invitations_normalise_email
  before insert or update of email on public.invitations
  for each row execute function public.normalise_email();

create trigger admins_normalise_email
  before insert or update of email on public.admins
  for each row execute function public.normalise_email();

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Invitation-only signup
-- ---------------------------------------------------------------------------

create function public.is_invited(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.invitations where email = lower(trim(p_email)));
$$;

-- Before User Created hook. Returns {} to allow, or an error object to reject.
create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.is_invited(event -> 'user' ->> 'email') then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'This email address is not on the invitation list. '
               'Please use the address you were invited with.'
  ));
end;
$$;

-- Fallback: the same rule as a trigger on auth.users.
create function public.enforce_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_invited(new.email) then
    raise exception 'This email address is not on the invitation list.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger on_auth_user_enforce_invitation
  before insert on auth.users
  for each row execute function public.enforce_invitation();

-- Create the profile from the invitation when the account is created. Names fall back to
-- what Google supplies when the invitation leaves them blank.
create function public.create_profile_from_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv  public.invitations;
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  select * into inv from public.invitations where email = lower(trim(new.email));

  insert into public.profiles
    (id, email, church, cohort, given_name, family_name, mother_tongue, other_languages)
  values (
    new.id,
    lower(trim(new.email)),
    inv.church,
    inv.cohort,
    coalesce(nullif(inv.given_name, ''),  meta ->> 'given_name',
             split_part(coalesce(meta ->> 'full_name', meta ->> 'name', ''), ' ', 1)),
    coalesce(nullif(inv.family_name, ''), meta ->> 'family_name',
             nullif(regexp_replace(coalesce(meta ->> 'full_name', meta ->> 'name', ''), '^\S+\s*', ''), '')),
    inv.mother_tongue,
    inv.other_languages
  );
  return new;
end;
$$;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_profile_from_invitation();

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.admins a on a.email = lower(u.email)
    where u.id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.churches    enable row level security;
alter table public.cohorts     enable row level security;
alter table public.invitations enable row level security;
alter table public.admins      enable row level security;
alter table public.profiles    enable row level security;

-- Churches and cohorts: members see their own; admins see and manage everything.
create policy "members read own church" on public.churches
  for select to authenticated
  using (id = (select church from public.profiles where id = auth.uid()));
create policy "admins manage churches" on public.churches
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "members read own cohort" on public.cohorts
  for select to authenticated
  using (id = (select cohort from public.profiles where id = auth.uid()));
create policy "admins manage cohorts" on public.cohorts
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Invitations: admins only.
create policy "admins manage invitations" on public.invitations
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Profiles: people read and edit their own; admins read and edit all.
-- Profiles are only ever created by the trigger above, so there is no insert policy.
create policy "read own profile" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

-- Users may only change their own details, not their email, church or cohort.
revoke update on public.profiles from anon, authenticated;
grant update (given_name, family_name, mother_tongue, other_languages, confirmed_at)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Function permissions
-- ---------------------------------------------------------------------------

revoke execute on function public.is_invited(text)                 from public, anon, authenticated;
revoke execute on function public.hook_before_user_created(jsonb)  from public, anon, authenticated;
revoke execute on function public.enforce_invitation()             from public, anon, authenticated;
revoke execute on function public.create_profile_from_invitation() from public, anon, authenticated;
revoke execute on function public.is_admin()                       from public, anon;
grant  execute on function public.is_admin()                       to authenticated;

-- The auth server runs the hook as supabase_auth_admin.
grant usage   on schema public                                     to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb)   to supabase_auth_admin;
grant execute on function public.is_invited(text)                  to supabase_auth_admin;
