insert into public.store_products(id,category,name,subtitle,price_usd,stock,warranty_days,access_label,sort_order)
values
('aws-640','AWS Cloud Accounts','AWS Cloud — 640 vCPU','High Credit · Bedrock access included',350,10,30,'Full access · Official support',110),
('aws-1080','AWS Cloud Accounts','AWS Cloud — 1080 vCPU','High Credit · Bedrock access included',600,5,30,'Full access · Official support',120),
('aws-1920','AWS Cloud Accounts','AWS Cloud — 1920 vCPU','High Credit · Bedrock access included',950,5,30,'Full access · Official support',130)
on conflict(id) do update set
 category=excluded.category,
 name=excluded.name,
 subtitle=excluded.subtitle,
 price_usd=excluded.price_usd,
 stock=excluded.stock,
 warranty_days=excluded.warranty_days,
 access_label=excluded.access_label,
 active=true,
 sort_order=excluded.sort_order,
 updated_at=now();
