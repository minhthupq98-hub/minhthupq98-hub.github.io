-- The Khe Order & Profit
-- Run this entire file once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.products (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  name text not null,
  category text not null check (category in ('Mì', 'Matcha', 'Trà', 'Trà sữa')),
  price integer not null default 0 check (price >= 0),
  grab_price integer not null default 0 check (grab_price >= 0),
  cost integer not null default 0 check (cost >= 0),
  color text not null default '#CFDBB1',
  icon text not null default '🥤',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  channel text not null check (channel in ('Tại quán', 'Mang đi', 'Grab')),
  items jsonb not null default '[]'::jsonb,
  subtotal integer not null default 0 check (subtotal >= 0),
  discount integer not null default 0 check (discount >= 0),
  revenue integer not null default 0 check (revenue >= 0),
  cost integer not null default 0 check (cost >= 0),
  note text not null default '',
  status text not null default 'completed' check (status in ('completed', 'cancelled')),
  legacy_code text,
  updated_at timestamptz not null default now()
);

create index if not exists orders_owner_created_idx
  on public.orders (owner_id, created_at desc);

create table if not exists public.daily_costs (
  owner_id uuid not null references auth.users(id) on delete cascade,
  report_date date not null,
  amount integer not null default 0 check (amount >= 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, report_date)
);

create table if not exists public.app_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  grab_fee_rate numeric(5,2) not null default 30 check (grab_fee_rate between 0 and 100),
  updated_at timestamptz not null default now()
);

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists daily_costs_set_updated_at on public.daily_costs;
create trigger daily_costs_set_updated_at
before update on public.daily_costs
for each row execute function public.set_updated_at();

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.daily_costs enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists "owners manage products" on public.products;
create policy "owners manage products"
on public.products for all
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "owners manage orders" on public.orders;
create policy "owners manage orders"
on public.orders for all
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "owners manage daily costs" on public.daily_costs;
create policy "owners manage daily costs"
on public.daily_costs for all
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "owners manage settings" on public.app_settings;
create policy "owners manage settings"
on public.app_settings for all
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.orders to authenticated;
grant select, insert, update, delete on public.daily_costs to authenticated;
grant select, insert, update, delete on public.app_settings to authenticated;
grant usage, select on all sequences in schema public to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products'
  ) then alter publication supabase_realtime add table public.products; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then alter publication supabase_realtime add table public.orders; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daily_costs'
  ) then alter publication supabase_realtime add table public.daily_costs; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_settings'
  ) then alter publication supabase_realtime add table public.app_settings; end if;
end $$;
