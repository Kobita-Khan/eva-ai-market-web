grant select, insert, update on table public.store_products to service_role;
grant select, insert, update on table public.store_orders to service_role;

revoke all on table public.store_products, public.store_orders from anon, authenticated;
