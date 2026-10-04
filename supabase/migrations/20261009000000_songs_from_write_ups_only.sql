-- Songs come from each cohort's write-up (loaded by pipeline/load_session.py), not from the Admin page, and
-- there are no "standard songs": a cohort with no songs for a part simply has none, like any other part
-- with no material of its own.

-- Church admins no longer edit songs.
drop policy "church admins manage their songs" on public.contributions;

alter table public.segments drop column songs;
