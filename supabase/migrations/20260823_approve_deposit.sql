create or replace function public.approve_deposit(
  p_deposit_id uuid,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deposit public.deposits%rowtype;
  v_balance numeric(14,6);
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not authorized';
  end if;

  select * into v_deposit
  from public.deposits
  where id = p_deposit_id
  for update;

  if not found then raise exception 'Deposit not found'; end if;
  if v_deposit.status <> 'pending' then raise exception 'Deposit is already reviewed'; end if;

  update public.wallets
  set balance_usd = balance_usd + v_deposit.amount_usdt,
      updated_at = now()
  where user_id = v_deposit.user_id
  returning balance_usd into v_balance;

  if v_balance is null then raise exception 'Customer wallet not found'; end if;

  update public.deposits
  set status = 'approved', admin_note = p_admin_note, reviewed_at = now()
  where id = p_deposit_id;

  insert into public.wallet_ledger(user_id, amount_usd, entry_type, description, reference_id, balance_after)
  values(v_deposit.user_id, v_deposit.amount_usdt, 'deposit', 'USDT deposit approved', v_deposit.id, v_balance);

  return jsonb_build_object('deposit_id', v_deposit.id, 'user_id', v_deposit.user_id, 'balance', v_balance);
end;
$$;

revoke all on function public.approve_deposit(uuid,text) from public, anon, authenticated;
grant execute on function public.approve_deposit(uuid,text) to service_role;
