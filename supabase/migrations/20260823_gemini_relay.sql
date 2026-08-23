create extension if not exists pgcrypto;

alter table public.api_keys
  add column if not exists key_hash text,
  add column if not exists name text default 'Default key';

create unique index if not exists api_keys_key_hash_unique
  on public.api_keys(key_hash)
  where key_hash is not null;

create or replace function public.record_gemini_usage(
  p_user_id uuid,
  p_api_key_id uuid,
  p_model text,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_cost_usd numeric,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(14,6);
  v_usage_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not authorized';
  end if;

  if p_cost_usd <= 0 then raise exception 'Invalid usage cost'; end if;

  perform 1 from public.api_keys
  where id = p_api_key_id and user_id = p_user_id and status = 'active'
  for update;
  if not found then raise exception 'API key is not active'; end if;

  select balance_usd into v_balance
  from public.wallets
  where user_id = p_user_id
  for update;

  if v_balance is null then raise exception 'Wallet not found'; end if;
  if v_balance < p_cost_usd then raise exception 'Insufficient balance'; end if;

  v_balance := v_balance - p_cost_usd;

  update public.wallets
  set balance_usd = v_balance, updated_at = now()
  where user_id = p_user_id;

  insert into public.usage_records(
    user_id, api_key_id, provider, model, input_tokens, output_tokens, cost_usd, request_id
  ) values (
    p_user_id, p_api_key_id, 'gemini', p_model,
    p_input_tokens, p_output_tokens, p_cost_usd, p_request_id
  ) returning id into v_usage_id;

  insert into public.wallet_ledger(
    user_id, amount_usd, entry_type, description, reference_id, balance_after
  ) values (
    p_user_id, -p_cost_usd, 'usage', 'Gemini API usage', v_usage_id, v_balance
  );

  update public.api_keys
  set last_used_at = now()
  where id = p_api_key_id;

  return jsonb_build_object(
    'usage_id', v_usage_id,
    'charged_usd', p_cost_usd,
    'balance', v_balance
  );
end;
$$;

revoke all on function public.record_gemini_usage(uuid,uuid,text,bigint,bigint,numeric,uuid)
  from public, anon, authenticated;
grant execute on function public.record_gemini_usage(uuid,uuid,text,bigint,bigint,numeric,uuid)
  to service_role;
