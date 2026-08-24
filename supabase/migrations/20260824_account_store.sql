create table if not exists public.store_products (
  id text primary key,
  category text not null,
  name text not null,
  subtitle text not null default '',
  price_usd numeric(14,2) not null check (price_usd > 0),
  stock integer not null default 0 check (stock >= 0),
  warranty_days integer not null default 30 check (warranty_days >= 0),
  access_label text,
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.store_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null references public.store_products(id),
  product_name text not null,
  price_usd numeric(14,2) not null check (price_usd > 0),
  status text not null default 'approved' check (status in ('approved','processing','delivered','cancelled','refunded')),
  warranty_days integer not null default 30,
  delivery_details text,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index if not exists store_orders_user_created_idx on public.store_orders(user_id,created_at desc);
alter table public.store_products enable row level security;
alter table public.store_orders enable row level security;
revoke all on public.store_products, public.store_orders from anon, authenticated;

insert into public.store_products(id,category,name,subtitle,price_usd,stock,warranty_days,access_label,sort_order) values
('claude-pro','Claude Accounts','Claude Pro','Premium account',15,20,30,'Full account access',10),
('claude-max-5x','Claude Accounts','Claude Max 5x','Premium account',35,10,30,'Full account access',20),
('claude-max-20x','Claude Accounts','Claude Max 20x','Premium account',80,5,30,'Full account access',30),
('claude-max-20x-365','Claude Accounts','Claude Max 20x','365 Days',150,5,30,'Full account access',40),
('aws-8','AWS Cloud Accounts','AWS Cloud — 8 vCPU','Bedrock access included',30,20,30,'Full access',50),
('aws-16','AWS Cloud Accounts','AWS Cloud — 16 vCPU','Bedrock access included',50,20,30,'Full access',60),
('aws-64','AWS Cloud Accounts','AWS Cloud — 64 vCPU','Bedrock access included',80,10,30,'Full access',70),
('aws-128','AWS Cloud Accounts','AWS Cloud — 128 vCPU','Bedrock access included',100,10,30,'Full access',80),
('aws-256','AWS Cloud Accounts','AWS Cloud — 256 vCPU','Bedrock access included',180,5,30,'Full access',90),
('aws-512','AWS Cloud Accounts','AWS Cloud — 512 vCPU','Bedrock access included',250,5,30,'Full access',100)
on conflict(id) do update set category=excluded.category,name=excluded.name,subtitle=excluded.subtitle,price_usd=excluded.price_usd,stock=excluded.stock,warranty_days=excluded.warranty_days,access_label=excluded.access_label,sort_order=excluded.sort_order,updated_at=now();

create or replace function public.purchase_store_product(p_user_id uuid,p_product_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_product public.store_products%rowtype; v_balance numeric(14,6); v_order_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  select * into v_product from public.store_products where id=p_product_id and active=true for update;
  if not found then raise exception 'Product unavailable'; end if;
  if v_product.stock < 1 then raise exception 'Out of stock'; end if;
  select balance_usd into v_balance from public.wallets where user_id=p_user_id for update;
  if v_balance is null then raise exception 'Customer wallet not found'; end if;
  if v_balance < v_product.price_usd then raise exception 'Insufficient balance'; end if;
  v_balance := v_balance-v_product.price_usd;
  update public.wallets set balance_usd=v_balance,updated_at=now() where user_id=p_user_id;
  update public.store_products set stock=stock-1,updated_at=now() where id=v_product.id;
  insert into public.store_orders(user_id,product_id,product_name,price_usd,warranty_days)
  values(p_user_id,v_product.id,v_product.name||case when v_product.subtitle<>'' then ' — '||v_product.subtitle else '' end,v_product.price_usd,v_product.warranty_days)
  returning id into v_order_id;
  insert into public.wallet_ledger(user_id,amount_usd,entry_type,description,reference_id,balance_after)
  values(p_user_id,-v_product.price_usd,'purchase','Store purchase: '||v_product.name,v_order_id,v_balance);
  return jsonb_build_object('order_id',v_order_id,'balance',v_balance,'stock',v_product.stock-1);
end $$;

create or replace function public.admin_update_store_order(p_order_id uuid,p_status text,p_delivery_details text default null,p_admin_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_order public.store_orders%rowtype; v_balance numeric(14,6);
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  if p_status not in ('approved','processing','delivered','cancelled','refunded') then raise exception 'Invalid status'; end if;
  select * into v_order from public.store_orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status='refunded' then raise exception 'Refunded order cannot be changed'; end if;
  if p_status='refunded' and v_order.status<>'refunded' then
    select balance_usd into v_balance from public.wallets where user_id=v_order.user_id for update;
    v_balance:=v_balance+v_order.price_usd;
    update public.wallets set balance_usd=v_balance,updated_at=now() where user_id=v_order.user_id;
    update public.store_products set stock=stock+1,updated_at=now() where id=v_order.product_id;
    insert into public.wallet_ledger(user_id,amount_usd,entry_type,description,reference_id,balance_after)
    values(v_order.user_id,v_order.price_usd,'refund','Store refund: '||v_order.product_name,v_order.id,v_balance);
  end if;
  update public.store_orders set status=p_status,delivery_details=coalesce(nullif(p_delivery_details,''),delivery_details),admin_note=coalesce(nullif(p_admin_note,''),admin_note),updated_at=now(),delivered_at=case when p_status='delivered' then now() else delivered_at end where id=p_order_id;
  return jsonb_build_object('order_id',p_order_id,'status',p_status);
end $$;

create or replace function public.admin_set_product_stock(p_product_id text,p_stock integer)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.role()<>'service_role' then raise exception 'Not authorized'; end if;
 if p_stock<0 or p_stock>10000 then raise exception 'Invalid stock'; end if;
 update public.store_products set stock=p_stock,updated_at=now() where id=p_product_id;
 if not found then raise exception 'Product not found'; end if;
 return jsonb_build_object('product_id',p_product_id,'stock',p_stock);
end $$;
revoke all on function public.purchase_store_product(uuid,text),public.admin_update_store_order(uuid,text,text,text),public.admin_set_product_stock(text,integer) from public,anon,authenticated;
grant execute on function public.purchase_store_product(uuid,text),public.admin_update_store_order(uuid,text,text,text),public.admin_set_product_stock(text,integer) to service_role;
