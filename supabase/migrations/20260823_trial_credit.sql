create or replace function public.grant_trial_credit(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(14,6);
  v_amount numeric(14,6) := 0.10;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not authorized';
  end if;

  if exists (
    select 1 from public.wallet_ledger
    where user_id = p_user_id
      and description = 'One-time Gemini trial credit'
  ) then
    raise exception 'Trial credit was already granted';
  end if;

  update public.wallets
  set balance_usd = balance_usd + v_amount,
      updated_at = now()
  where user_id = p_user_id
  returning balance_usd into v_balance;

  if v_balance is null then raise exception 'Customer wallet not found'; end if;

  insert into public.wallet_ledger(
    user_id, amount_usd, entry_type, description, balance_after
  ) values (
    p_user_id, v_amount, 'adjustment', 'One-time Gemini trial credit', v_balance
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'amount', v_amount,
    'balance', v_balance
  );
end;
$$;

revoke all on function public.grant_trial_credit(uuid)
  from public, anon, authenticated;
grant execute on function public.grant_trial_credit(uuid)
  to service_role;
