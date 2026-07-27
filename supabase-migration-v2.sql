-- The Khe Order & Profit · nâng cấp v2
-- Chạy toàn bộ file này một lần trong Supabase Dashboard -> SQL Editor.
-- File chỉ bổ sung cột và ràng buộc; không xóa đơn, món hoặc dữ liệu hiện có.

alter table public.products
  drop constraint if exists products_category_check;

alter table public.products
  add constraint products_category_check
  check (category in ('Mì', 'Matcha', 'Trà', 'Trà sữa', 'Cà phê'));

alter table public.orders
  add column if not exists discount_type text not null default 'amount',
  add column if not exists discount_value numeric(12,2) not null default 0,
  add column if not exists payment_method text not null default 'Tiền mặt';

update public.orders
set
  discount_type = coalesce(discount_type, 'amount'),
  discount_value = case
    when discount_value = 0 and discount > 0 then discount
    else discount_value
  end,
  payment_method = coalesce(payment_method, 'Tiền mặt');

alter table public.orders
  drop constraint if exists orders_status_check,
  drop constraint if exists orders_discount_type_check,
  drop constraint if exists orders_discount_value_check,
  drop constraint if exists orders_payment_method_check;

alter table public.orders
  alter column status set default 'processing',
  add constraint orders_status_check
    check (status in ('processing', 'completed', 'cancelled')),
  add constraint orders_discount_type_check
    check (discount_type in ('amount', 'percent')),
  add constraint orders_discount_value_check
    check (discount_value >= 0),
  add constraint orders_payment_method_check
    check (payment_method in ('Tiền mặt', 'Chuyển khoản'));