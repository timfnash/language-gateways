-- The unsubscribe page shows where someone stands, so the link in any old email works both ways: unsubscribe, or
-- resubscribe if they already have. Reading the status changes nothing (mail scanners open links).

-- true = unsubscribed, false = subscribed, null = no such code.
create function public.unsubscribe_status(p_code uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select unsubscribed_at is not null from public.email_preferences where unsubscribe_code = p_code;
$$;

revoke execute on function public.unsubscribe_status(uuid) from public;
grant  execute on function public.unsubscribe_status(uuid) to anon, authenticated;
