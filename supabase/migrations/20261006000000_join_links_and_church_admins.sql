-- Join links and church admins.
--
-- Join links: each cohort has a random join code. Someone with the link can create an account
-- (so signup is no longer only for invited emails), but if the cohort requires approval their
-- profile starts as 'pending' and they can see no course content until an admin, or an admin of
-- their church, approves them. Approval adds them to the invitations list. Invitations work as before.
--
-- Roles: admins (public.admins) can do everything. Church admins (public.church_admins) can approve
-- or decline join requests from their church and see their church's invitations and members.

-- ---------------------------------------------------------------------------
-- Tables and columns
-- ---------------------------------------------------------------------------

alter table public.cohorts
  add column join_code text unique default substr(md5(gen_random_uuid()::text), 1, 10)
    check (join_code ~ '^[A-Za-z0-9]{6,}$'),
  add column join_requires_approval boolean not null default true;
update public.cohorts set join_code = substr(md5(gen_random_uuid()::text), 1, 10) where join_code is null;

alter table public.profiles
  add column status text not null default 'active' check (status in ('pending', 'active'));

-- One church per church admin. No RLS policies: changed only through admin_set_role().
create table public.church_admins (
  email      text primary key,
  church     text not null references public.churches (id) on update cascade on delete cascade,
  created_at timestamptz not null default now()
);
create trigger church_admins_normalise_email
  before insert or update of email on public.church_admins
  for each row execute function public.normalise_email();
alter table public.church_admins enable row level security;

-- ---------------------------------------------------------------------------
-- Membership now means an *active* profile
-- ---------------------------------------------------------------------------

create or replace function public.my_cohort()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select cohort from public.profiles where id = auth.uid() and status = 'active';
$$;

create or replace function public.my_church()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select church from public.profiles where id = auth.uid() and status = 'active';
$$;

-- Notes need an active membership too.
create or replace function public.note_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select church, cohort into new.church, new.cohort
    from public.profiles where id = new.user_id and status = 'active';
  if new.church is null then
    raise exception 'Only course members can write notes.' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and (new.body is distinct from old.body or new.visibility is distinct from old.visibility) then
    new.approved_at := null;
  end if;
  return new;
end;
$$;

-- The church the caller administers, if any.
create function public.my_admin_church()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ca.church from public.church_admins ca
  join auth.users u on lower(u.email) = ca.email
  where u.id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Signing up: invited, or holding a valid join code
-- ---------------------------------------------------------------------------

create function public.is_join_code(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_code is not null and exists (select 1 from public.cohorts where join_code = p_code);
$$;

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.is_invited(event -> 'user' ->> 'email')
     or public.is_join_code(coalesce(event -> 'user' -> 'user_metadata' ->> 'join_code',
                                     event -> 'user' -> 'raw_user_meta_data' ->> 'join_code')) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'This email address is not on the invitation list. '
               'Please use the address you were invited with, or the join link from your church.'
  ));
end;
$$;

create or replace function public.enforce_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_invited(new.email)
     and not public.is_join_code(new.raw_user_meta_data ->> 'join_code') then
    raise exception 'This email address is not on the invitation list.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- Invited people get an active profile from their invitation (as before). People who joined with a
-- link get a profile in that cohort: pending if it needs approval, otherwise active and added to the
-- invitations list.
create or replace function public.create_profile_from_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv  public.invitations;
  coh  public.cohorts;
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  e    text := lower(trim(new.email));
  given  text;
  family text;
begin
  select * into inv from public.invitations where email = e;
  given  := coalesce(nullif(inv.given_name, ''),  nullif(trim(meta ->> 'given_name'), ''),
                     split_part(coalesce(meta ->> 'full_name', meta ->> 'name', ''), ' ', 1));
  family := coalesce(nullif(inv.family_name, ''), nullif(trim(meta ->> 'family_name'), ''),
                     nullif(regexp_replace(coalesce(meta ->> 'full_name', meta ->> 'name', ''), '^\S+\s*', ''), ''));

  if inv.email is not null then
    insert into public.profiles (id, email, church, cohort, given_name, family_name, mother_tongue, other_languages)
    values (new.id, e, inv.church, inv.cohort, given, family, inv.mother_tongue, inv.other_languages);
    return new;
  end if;

  select * into coh from public.cohorts where join_code = meta ->> 'join_code';
  insert into public.profiles (id, email, church, cohort, given_name, family_name, mother_tongue, other_languages, status)
  values (new.id, e, coh.church, coh.id, given, family,
          nullif(trim(meta ->> 'mother_tongue'), ''), nullif(trim(meta ->> 'other_languages'), ''),
          case when coh.join_requires_approval then 'pending' else 'active' end);
  if not coh.join_requires_approval then
    insert into public.invitations (email, church, cohort, given_name, family_name, mother_tongue, other_languages)
    select p.email, p.church, p.cohort, p.given_name, p.family_name, p.mother_tongue, p.other_languages
      from public.profiles p where p.id = new.id
    on conflict (email) do nothing;
  end if;
  return new;
end;
$$;

-- What the join page shows before signing up: just the names, for a valid code.
create function public.join_cohort_info(p_code text)
returns table (church text, cohort text, requires_approval boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select ch.name, c.name, c.join_requires_approval
  from public.cohorts c join public.churches ch on ch.id = c.church
  where c.join_code = p_code;
$$;

-- ---------------------------------------------------------------------------
-- Approving join requests (admins, or admins of the person's church)
-- ---------------------------------------------------------------------------

create function public.can_manage_church(p_church text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or public.my_admin_church() = p_church;
$$;

create function public.admin_join_requests()
returns table (id uuid, email text, given_name text, family_name text, mother_tongue text,
               other_languages text, church text, cohort text, created_at timestamptz)
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
    select p.id, p.email, p.given_name, p.family_name, p.mother_tongue, p.other_languages, p.church, p.cohort, p.created_at
    from public.profiles p
    where p.status = 'pending' and public.can_manage_church(p.church)
    order by p.created_at;
end;
$$;

create function public.approve_join_request(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles;
begin
  select * into p from public.profiles where id = p_user and status = 'pending';
  if p.id is null then
    raise exception 'No such request.';
  end if;
  if not public.can_manage_church(p.church) then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  update public.profiles set status = 'active' where id = p_user;
  insert into public.invitations (email, church, cohort, given_name, family_name, mother_tongue, other_languages)
  values (p.email, p.church, p.cohort, p.given_name, p.family_name, p.mother_tongue, p.other_languages)
  on conflict (email) do nothing;
end;
$$;

-- Declining deletes the pending account (it has no notes or progress yet).
create function public.decline_join_request(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles;
begin
  select * into p from public.profiles where id = p_user and status = 'pending';
  if p.id is null then
    raise exception 'No such request.';
  end if;
  if not public.can_manage_church(p.church) then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  delete from auth.users where id = p_user;
end;
$$;

-- Church admins can see their church, its cohorts, invitations and members (admins already see everything).
create policy "church admins read their church" on public.churches
  for select to authenticated
  using (id = (select public.my_admin_church()));
create policy "church admins read their cohorts" on public.cohorts
  for select to authenticated
  using (church = (select public.my_admin_church()));
create policy "church admins read their invitations" on public.invitations
  for select to authenticated
  using (church = (select public.my_admin_church()));
create policy "church admins read their members" on public.profiles
  for select to authenticated
  using (church = (select public.my_admin_church()));

-- ---------------------------------------------------------------------------
-- Roles: none → church admin → admin (set by admins only)
-- ---------------------------------------------------------------------------

drop function public.admin_set_admin(text, boolean);
drop function public.admin_list_admins();

-- My own role, for the page: 'admin', 'church' or null, with the church for a church admin.
create function public.my_role()
returns table (role text, church text)
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_admin() then 'admin' when public.my_admin_church() is not null then 'church' end,
         public.my_admin_church();
$$;

create function public.admin_list_roles()
returns table (email text, role text, church text)
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
    select a.email, 'admin'::text, null::text from public.admins a
    union all
    select ca.email, 'church'::text, ca.church from public.church_admins ca
    where not exists (select 1 from public.admins a where a.email = ca.email);
end;
$$;

create function public.admin_set_role(p_email text, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e  text := lower(trim(p_email));
  me text := (select lower(email) from auth.users where id = auth.uid());
  ch text;
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  if p_role not in ('none', 'church', 'admin') then
    raise exception 'Unknown role %.', p_role;
  end if;
  if e = me then
    raise exception 'You can''t change your own role. Ask another admin to do it.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_role <> 'admin' and exists (select 1 from public.admins where email = e)
     and (select count(*) from public.admins) <= 1 then
    raise exception 'There must always be at least one admin.' using errcode = 'insufficient_privilege';
  end if;
  if p_role = 'church' then
    ch := coalesce((select church from public.invitations where email = e),
                   (select church from public.profiles where email = e));
    if ch is null then
      raise exception 'Invite them to a church first.';
    end if;
  end if;

  delete from public.admins where email = e;
  delete from public.church_admins where email = e;
  if p_role = 'admin' then insert into public.admins (email) values (e); end if;
  if p_role = 'church' then insert into public.church_admins (email, church) values (e, ch); end if;
end;
$$;

-- Removing a person also removes any church admin role.
create or replace function public.admin_remove_person(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  e text := lower(trim(p_email));
  removed text := 'none';
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.admins where email = e) then
    raise exception 'That person is an admin. Remove their admin rights first.'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.church_admins where email = e;
  delete from auth.users where lower(email) = e;
  if found then removed := 'account'; end if;

  delete from public.invitations where email = e;
  if found and removed = 'none' then removed := 'invitation'; end if;

  return removed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function permissions
-- ---------------------------------------------------------------------------

revoke execute on function public.my_admin_church()              from public, anon;
grant  execute on function public.my_admin_church()              to authenticated;
revoke execute on function public.is_join_code(text)             from public, anon, authenticated;
grant  execute on function public.is_join_code(text)             to supabase_auth_admin;
revoke execute on function public.join_cohort_info(text)         from public;
grant  execute on function public.join_cohort_info(text)         to anon, authenticated;
revoke execute on function public.can_manage_church(text)        from public, anon;
grant  execute on function public.can_manage_church(text)        to authenticated;
revoke execute on function public.admin_join_requests()          from public, anon;
grant  execute on function public.admin_join_requests()          to authenticated;
revoke execute on function public.approve_join_request(uuid)     from public, anon;
grant  execute on function public.approve_join_request(uuid)     to authenticated;
revoke execute on function public.decline_join_request(uuid)     from public, anon;
grant  execute on function public.decline_join_request(uuid)     to authenticated;
revoke execute on function public.my_role()                      from public, anon;
grant  execute on function public.my_role()                      to authenticated;
revoke execute on function public.admin_list_roles()             from public, anon;
grant  execute on function public.admin_list_roles()             to authenticated;
revoke execute on function public.admin_set_role(text, text)     from public, anon;
grant  execute on function public.admin_set_role(text, text)     to authenticated;
