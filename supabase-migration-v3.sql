-- The Khe Order & Profit · nâng cấp v3
-- Chạy toàn bộ file này một lần trong Supabase Dashboard -> SQL Editor.
-- File chỉ mở thêm nhóm Topping đồ ăn và Extra đồ uống; không xóa hay sửa dữ liệu cũ.

alter table public.products
  drop constraint if exists products_category_check;

alter table public.products
  add constraint products_category_check
  check (
    category in (
      'Mì',
      'Matcha',
      'Trà',
      'Trà sữa',
      'Cà phê',
      'Topping đồ ăn',
      'Extra đồ uống'
    )
  );
