create table if not exists public.api_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  api_key_id uuid references public.api_keys(id) on delete set null,
  provider text not null check (provider in ('openai','gemini','claude')),
  model text not null,
  reserved_usd numeric(14,6) not null check (reserved_usd > 0),
  status text not null default 'reserved' check (status in ('reserved','finalized','released')),
  created_at timestamptz not null default now(),
  finalized_at timestamptz
);

create index if not exists api_usage_reservations_key_created_idx
  on public.api_usage_reservations(api_key_id, created_at desc);
create index if not exists api_usage_reservations_user_status_idx
  on public.api_usage_reservations(user_id, status, created_at desc);

alter table public.api_usage_reservations enable row level security;
revoke all on table public.api_usage_reservations from public, anon, authenticated;
grant select, insert, update, delete on table public.api_usage_reservations to service_role;

create or replace function public.reserve_api_usage(
  p_user_id uuid,
  p_api_key_id uuid,
  p_provider text,
  p_model text,
  p_max_cost_usd numeric,
  p_request_id uuid,
  p_requests_per_minute integer,
  p_max_concurrent integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance numeric(14,6);
  v_recent integer;
  v_active integer;
  v_reservation_id uuid;
begin
  if p_provider not in ('openai','gemini','claude') then raise exception 'Invalid provider'; end if;
  if p_max_cost_usd <= 0 or p_max_cost_usd > 100 then raise exception 'Invalid reservation amount'; end if;
  if p_requests_per_minute < 1 or p_requests_per_minute > 600 then raise exception 'Invalid rate limit'; end if;
  if p_max_concurrent < 1 or p_max_concurrent > 20 then raise exception 'Invalid concurrency limit'; end if;

  perform 1
  from public.api_keys
  where id = p_api_key_id and user_id = p_user_id and status = 'active'
  for update;
  if not found then raise exception 'API key is not active'; end if;

  select count(*) into v_recent
  from public.api_usage_reservations
  where api_key_id = p_api_key_id
    and created_at >= now() - interval '1 minute';
  if v_recent >= p_requests_per_minute then raise exception 'Rate limit exceeded'; end if;

  select count(*) into v_active
  from public.api_usage_reservations
  where api_key_id = p_api_key_id
    and status = 'reserved'
    and created_at >= now() - interval '2 minutes';
  if v_active >= p_max_concurrent then raise exception 'Too many concurrent requests'; end if;

  select balance_usd into v_balance
  from public.wallets
  where user_id = p_user_id
  for update;
  if v_balance is null then raise exception 'Wallet not found'; end if;
  if v_balance < p_max_cost_usd then raise exception 'Insufficient balance for requested maximum usage'; end if;

  v_balance := v_balance - p_max_cost_usd;
  update public.wallets
  set balance_usd = v_balance, updated_at = now()
  where user_id = p_user_id;

  insert into public.api_usage_reservations(
    request_id,user_id,api_key_id,provider,model,reserved_usd
  ) values (
    p_request_id,p_user_id,p_api_key_id,p_provider,p_model,p_max_cost_usd
  ) returning id into v_reservation_id;

  return jsonb_build_object(
    'reservation_id',v_reservation_id,
    'request_id',p_request_id,
    'reserved_usd',p_max_cost_usd,
    'balance',v_balance
  );
end;
$$;

create or replace function public.finalize_api_usage(
  p_request_id uuid,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_actual_cost_usd numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.api_usage_reservations%rowtype;
  v_balance numeric(14,6);
  v_refund numeric(14,6);
  v_extra numeric(14,6);
  v_usage_id uuid;
begin
  if p_actual_cost_usd <= 0 then raise exception 'Invalid usage cost'; end if;
  if p_input_tokens < 0 or p_output_tokens < 0 then raise exception 'Invalid token count'; end if;

  select * into v_res
  from public.api_usage_reservations
  where request_id = p_request_id
  for update;
  if not found then raise exception 'Reservation not found'; end if;
  if v_res.status <> 'reserved' then raise exception 'Reservation is not active'; end if;

  select balance_usd into v_balance
  from public.wallets
  where user_id = v_res.user_id
  for update;
  if v_balance is null then raise exception 'Wallet not found'; end if;

  if p_actual_cost_usd <= v_res.reserved_usd then
    v_refund := v_res.reserved_usd - p_actual_cost_usd;
    if v_refund > 0 then
      v_balance := v_balance + v_refund;
      update public.wallets set balance_usd = v_balance, updated_at = now() where user_id = v_res.user_id;
    end if;
  else
    v_extra := p_actual_cost_usd - v_res.reserved_usd;
    if v_balance < v_extra then raise exception 'Reserved amount was insufficient'; end if;
    v_balance := v_balance - v_extra;
    update public.wallets set balance_usd = v_balance, updated_at = now() where user_id = v_res.user_id;
  end if;

  insert into public.usage_records(
    user_id,api_key_id,provider,model,input_tokens,output_tokens,cost_usd,request_id
  ) values (
    v_res.user_id,v_res.api_key_id,v_res.provider,v_res.model,
    p_input_tokens,p_output_tokens,p_actual_cost_usd,p_request_id
  ) returning id into v_usage_id;

  insert into public.wallet_ledger(
    user_id,amount_usd,entry_type,description,reference_id,balance_after
  ) values (
    v_res.user_id,-p_actual_cost_usd,'usage',
    case v_res.provider when 'openai' then 'OpenAI API usage' when 'gemini' then 'Gemini API usage' else 'Claude API usage' end,
    v_usage_id,v_balance
  );

  update public.api_keys set last_used_at = now() where id = v_res.api_key_id;
  update public.api_usage_reservations
  set status='finalized', finalized_at=now()
  where id=v_res.id;

  return jsonb_build_object(
    'usage_id',v_usage_id,
    'charged_usd',p_actual_cost_usd,
    'reserved_usd',v_res.reserved_usd,
    'balance',v_balance
  );
end;
$$;

create or replace function public.release_api_usage(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.api_usage_reservations%rowtype;
  v_balance numeric(14,6);
begin
  select * into v_res
  from public.api_usage_reservations
  where request_id = p_request_id
  for update;
  if not found then return jsonb_build_object('released',false,'reason','not_found'); end if;
  if v_res.status <> 'reserved' then return jsonb_build_object('released',false,'reason',v_res.status); end if;

  select balance_usd into v_balance
  from public.wallets
  where user_id = v_res.user_id
  for update;
  if v_balance is null then raise exception 'Wallet not found'; end if;

  v_balance := v_balance + v_res.reserved_usd;
  update public.wallets set balance_usd=v_balance, updated_at=now() where user_id=v_res.user_id;
  update public.api_usage_reservations set status='released', finalized_at=now() where id=v_res.id;

  return jsonb_build_object('released',true,'balance',v_balance);
end;
$$;

revoke all on function public.reserve_api_usage(uuid,uuid,text,text,numeric,uuid,integer,integer) from public,anon,authenticated;
revoke all on function public.finalize_api_usage(uuid,bigint,bigint,numeric) from public,anon,authenticated;
revoke all on function public.release_api_usage(uuid) from public,anon,authenticated;
grant execute on function public.reserve_api_usage(uuid,uuid,text,text,numeric,uuid,integer,integer) to service_role;
grant execute on function public.finalize_api_usage(uuid,bigint,bigint,numeric) to service_role;
grant execute on function public.release_api_usage(uuid) to service_role;
