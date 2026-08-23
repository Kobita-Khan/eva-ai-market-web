begin;

create or replace function public.list_my_api_keys()
returns table (
  id uuid,
  key_prefix text,
  status text,
  created_at timestamptz,
  last_used_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select k.id, k.key_prefix, k.status, k.created_at, k.last_used_at
  from public.api_keys as k
  where k.user_id = auth.uid()
  order by k.created_at desc;
$$;

revoke all on function public.list_my_api_keys() from public;
grant execute on function public.list_my_api_keys() to authenticated;

commit;
