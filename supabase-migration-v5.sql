-- The Khe Order & Profit · nâng cấp v5
-- Chạy toàn bộ file này một lần trong Supabase Dashboard -> SQL Editor.
-- Bổ sung tên khách hàng và trạng thái đã/chưa thanh toán cho đơn hàng.
-- Đơn cũ được đánh dấu đã thanh toán; đơn tạo mới mặc định chưa thanh toán.

alter table public.orders
  add column if not exists customer_name text not null default '',
  add column if not exists payment_status text not null default 'paid';

update public.orders
set
  customer_name = coalesce(customer_name, ''),
  payment_status = coalesce(payment_status, 'paid');

alter table public.orders
  drop constraint if exists orders_payment_status_check;

alter table public.orders
  add constraint orders_payment_status_check
    check (payment_status in ('paid', 'unpaid')),
  alter column payment_status set default 'unpaid';
