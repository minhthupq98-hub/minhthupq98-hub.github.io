-- THE KHE · MIGRATION V13 · SỬA FORM QUÊN PIN VÀ ĐỐI CHIẾU TÊN
-- Chạy toàn bộ file một lần trong Supabase Dashboard -> SQL Editor.
-- Chỉ cần một từ trong tên khách nhập trùng với tên đã lưu.
-- Ví dụ tên lưu "c Mai", khách nhập "Mai" vẫn hợp lệ.

create extension if not exists unaccent with schema extensions;

create or replace function public.request_customer_pin_reset(
  p_shop_slug text,
  p_phone text,
  p_name text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_customer_auth_id uuid;
  v_phone text := public.normalize_vn_phone(p_phone);
  v_email text;
  v_saved_name text;
  v_name_matches boolean := false;
  v_existing public.customer_pin_reset_requests%rowtype;
begin
  if length(v_phone) < 9 or length(v_phone) > 11 then
    raise exception 'Vui lòng nhập đúng số điện thoại.';
  end if;

  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Vui lòng nhập ít nhất một phần tên đã dùng khi đặt hàng.';
  end if;

  select owner_id into v_owner_id
  from public.app_settings
  where public_order_slug = lower(trim(coalesce(p_shop_slug, 'the-khe')))
    and online_ordering_enabled = true
  limit 1;

  if v_owner_id is null then
    raise exception 'Cửa hàng chưa mở order online.';
  end if;

  v_email := 'c' || case
    when left(v_phone, 1) = '0' then '84' || substr(v_phone, 2)
    else v_phone
  end || '@login.thekhe.app';

  select id into v_customer_auth_id
  from auth.users
  where lower(email) = lower(v_email)
  limit 1;

  if v_customer_auth_id is null then
    raise exception 'Không tìm thấy tài khoản với số điện thoại này.';
  end if;

  select name into v_saved_name
  from public.customers
  where owner_id = v_owner_id
    and public.normalize_vn_phone(phone) = v_phone
  limit 1;

  -- Nếu khách đã có tên trong danh sách thành viên, chỉ cần một từ trùng khớp.
  -- So sánh không phân biệt chữ hoa/thường và có/không có dấu tiếng Việt.
  if length(trim(coalesce(v_saved_name, ''))) >= 2 then
    select exists (
      select 1
      from regexp_split_to_table(
        extensions.unaccent(lower(trim(p_name))), '\s+'
      ) as entered(part)
      join regexp_split_to_table(
        extensions.unaccent(lower(trim(v_saved_name))), '\s+'
      ) as saved(part)
        on entered.part = saved.part
      where length(entered.part) >= 2
    ) into v_name_matches;

    if not v_name_matches then
      raise exception 'Tên chưa khớp với tài khoản. Chỉ cần nhập đúng một phần tên đã dùng khi đặt hàng.';
    end if;
  end if;

  select * into v_existing
  from public.customer_pin_reset_requests
  where owner_id = v_owner_id
    and customer_auth_id = v_customer_auth_id
    and status = 'pending'
  limit 1;

  if v_existing.id is not null then
    update public.customer_pin_reset_requests
    set submitted_name = trim(p_name), requested_at = now()
    where id = v_existing.id;

    return jsonb_build_object(
      'requestId', v_existing.id,
      'status', 'pending',
      'message', 'Yêu cầu đã được gửi lại cho quán.'
    );
  end if;

  insert into public.customer_pin_reset_requests (
    owner_id, customer_auth_id, customer_phone, submitted_name
  ) values (
    v_owner_id, v_customer_auth_id, v_phone, trim(p_name)
  )
  returning id into v_existing.id;

  return jsonb_build_object(
    'requestId', v_existing.id,
    'status', 'pending',
    'message', 'Đã gửi yêu cầu đặt lại PIN cho quán.'
  );
end;
$$;

revoke all on function public.request_customer_pin_reset(text, text, text)
  from public, anon, authenticated;
grant execute on function public.request_customer_pin_reset(text, text, text)
  to anon, authenticated;
