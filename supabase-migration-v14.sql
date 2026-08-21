-- THE KHE · Migration v14
-- Cấu hình topping/extra theo từng nhóm món.

alter table public.products
  add column if not exists modifier_group text not null default 'Topping',
  add column if not exists applies_to_categories text[] not null default '{}'::text[];

alter table public.products drop constraint if exists products_modifier_group_check;
alter table public.products
  add constraint products_modifier_group_check
  check (modifier_group in ('Topping', 'Đổi sữa', 'Đổi bột', 'Upsize', 'Khác'));

alter table public.products drop constraint if exists products_applies_to_categories_check;
alter table public.products
  add constraint products_applies_to_categories_check
  check (applies_to_categories <@ array[
    'Mì', 'Matcha', 'Trà', 'Trà sữa', 'Cà phê',
    'Bánh', 'Đồ tráng miệng', 'Nước khác'
  ]::text[]);

-- Gán cấu hình hợp lý cho dữ liệu đang có. Sau đó có thể chỉnh lại trực tiếp trong app.
update public.products
set
  modifier_group = case
    when lower(name) like '%upsize%' or lower(name) like '%size%' then 'Upsize'
    when lower(name) like '%chawa%' or lower(name) like '%đổi bột%' or lower(name) like '%nâng cấp matcha%' then 'Đổi bột'
    when lower(name) like '%oatside%' or lower(name) like '%meiji%' or lower(name) like '%đổi sữa%' then 'Đổi sữa'
    else 'Topping'
  end,
  applies_to_categories = case
    when category = 'Topping đồ ăn' then array['Mì']::text[]
    when category = 'Topping bánh' then array['Bánh', 'Đồ tráng miệng']::text[]
    when lower(name) like '%chawa%' or lower(name) like '%đổi bột%' or lower(name) like '%nâng cấp matcha%'
      then array['Matcha']::text[]
    when lower(name) like '%oatside%' or lower(name) like '%meiji%' or lower(name) like '%đổi sữa%'
      then array['Matcha', 'Trà sữa', 'Cà phê', 'Nước khác']::text[]
    else array['Matcha', 'Trà', 'Trà sữa', 'Cà phê', 'Nước khác']::text[]
  end
where category in ('Topping đồ ăn', 'Topping bánh', 'Extra đồ uống')
  and cardinality(applies_to_categories) = 0;

create or replace function public.get_public_storefront(p_shop_slug text default 'the-khe')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.app_settings%rowtype;
  v_products jsonb;
begin
  select * into v_settings
  from public.app_settings
  where public_order_slug = lower(trim(p_shop_slug))
    and online_ordering_enabled = true
  limit 1;

  if v_settings.owner_id is null then
    return jsonb_build_object('available', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'description', p.description,
    'imageUrl', p.image_url,
    'category', p.category,
    'price', p.price,
    'color', p.color,
    'icon', p.icon,
    'modifierGroup', p.modifier_group,
    'appliesToCategories', to_jsonb(p.applies_to_categories)
  ) order by p.created_at), '[]'::jsonb)
  into v_products
  from public.products p
  where p.owner_id = v_settings.owner_id and p.active = true;

  return jsonb_build_object(
    'available', true,
    'shopName', v_settings.shop_name,
    'pickupAddress', v_settings.pickup_address,
    'bankCode', v_settings.bank_code,
    'bankAccount', v_settings.bank_account,
    'bankAccountName', v_settings.bank_account_name,
    'paymentReady', length(trim(v_settings.bank_code)) > 0
      and length(trim(v_settings.bank_account)) > 0
      and length(trim(v_settings.bank_account_name)) > 0,
    'products', v_products
  );
end;
$$;

revoke all on function public.get_public_storefront(text) from public, anon, authenticated;
grant execute on function public.get_public_storefront(text) to anon, authenticated;

comment on column public.products.modifier_group is
  'Nhóm hiển thị trong màn hình tùy chỉnh món: Topping, Đổi sữa, Đổi bột, Upsize hoặc Khác.';
comment on column public.products.applies_to_categories is
  'Danh sách nhóm món chính được phép dùng topping/extra này.';
