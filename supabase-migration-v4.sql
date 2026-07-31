-- The Khe Order & Profit · nâng cấp v4
-- Chạy toàn bộ file này một lần trong Supabase Dashboard -> SQL Editor.
-- Bổ sung sổ chi phí chi tiết để báo cáo ngày/tháng và lợi nhuận thực tế.
-- Các khoản "Chi phí khác" đã nhập ở bản cũ được chuyển sang bảng mới, không bị mất.

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  expense_date date not null,
  name text not null,
  category text not null default 'Khác',
  amount integer not null default 0 check (amount >= 0),
  note text not null default '',
  legacy_source_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, legacy_source_date)
);

create index if not exists expenses_owner_date_idx
  on public.expenses (owner_id, expense_date desc);

drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at
before update on public.expenses
for each row execute function public.set_updated_at();

alter table public.expenses enable row level security;

drop policy if exists "owners manage expenses" on public.expenses;
create policy "owners manage expenses"
on public.expenses for all
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

grant select, insert, update, delete on public.expenses to authenticated;

insert into public.expenses (owner_id, expense_date, name, category, amount, note, legacy_source_date)
select owner_id, report_date, 'Chi phí khác đã nhập trước đây', 'Khác', amount,
       'Được chuyển tự động từ báo cáo ngày phiên bản cũ', report_date
from public.daily_costs
where amount > 0
on conflict (owner_id, legacy_source_date) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'expenses'
  ) then
    alter publication supabase_realtime add table public.expenses;
  end if;
end $$;
