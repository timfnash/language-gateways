-- The first church, cohort and admin. Run once in the SQL editor after the migration.
-- Attendee invitations are NOT kept here (the repo is public): import them as CSV.

insert into public.churches (id, name) values
  ('freedom-church-jersey', 'Freedom Church Jersey');

insert into public.cohorts (id, church, name, starts_on) values
  ('freedom-church-jersey-2026-09', 'freedom-church-jersey', 'Freedom Church Jersey, autumn 2026', '2026-09-29');

insert into public.invitations (email, church, cohort, given_name, family_name) values
  ('tim@zipf.me', 'freedom-church-jersey', 'freedom-church-jersey-2026-09', 'Tim', 'Nash');

insert into public.admins (email) values
  ('tim@zipf.me');
