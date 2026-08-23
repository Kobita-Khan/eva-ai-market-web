alter table public.api_keys enable row level security;

revoke select on table public.api_keys from authenticated;
grant select (
  id,
  user_id,
  key_prefix,
  name,
  status,
  created_at,
  last_used_at
) on table public.api_keys to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'api_keys'
      and policyname = 'Customers can read their own API keys'
  ) then
    create policy "Customers can read their own API keys"
      on public.api_keys
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;
end
$$;
