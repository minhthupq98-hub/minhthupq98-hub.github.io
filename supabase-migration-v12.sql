-- THE KHE · MIGRATION V12 · QUÊN MÃ PIN
-- Chạy toàn bộ file một lần trong Supabase Dashboard -> SQL Editor.
-- Khách gửi yêu cầu đặt lại PIN; chủ quán xác minh, cấp PIN tạm và khách bắt buộc đổi PIN mới.

create extension if not exists pgcrypto;

create table if not exists public.customer_pin_reset_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  customer_auth_id uuid not null references auth.users(id) on delete cascade,
  customer_phone text not null,
  submitted_name text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'issued', 'completed', 'cancelled')),
  requested_at timestamptz not null default now(),
  issued_at timestamptz,
  completed_at timestamptz,
  issued_by uuid references auth.users(id) on delete set null
);

create unique index if not exists customer_pin_reset_one_pending_idx
  on public.customer_pin_reset_requests (owner_id, customer_auth_id)
  where status = 'pending';

create index if not exists customer_pin_reset_owner_idx
  on public.customer_pin_reset_requests (owner_id, status, requested_at desc);

create table if not exists public.customer_pin_status (
  owner_id uuid not null references auth.users(id) on delete cascade,
  customer_auth_id uuid not null references auth.users(id) on delete cascade,
  must_change_pin boolean not null default false,
  temporary_pin_issued_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (owner_id, customer_auth_id)
);

alter table public.customer_pin_reset_requests enable row level security;
alter table public.customer_pin_status enable row level security;
revoke all on public.customer_pin_reset_requests from anon, authenticated;
revoke all on public.customer_pin_status from anon, authenticated;

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
  v_existing public.customer_pin_reset_requests%rowtype;
begin
  if length(v_phone) < 9 or length(v_phone) > 11 then
    raise exception 'Vui lòng nhập đúng số điện thoại.';
  end if;

  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Vui lòng nhập tên đã dùng khi đặt hàng.';
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

create or replace function public.get_pin_reset_requests()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Vui lòng đăng nhập quản trị.'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'phone', r.customer_phone,
      'name', coalesce(nullif(c.name, ''), nullif(r.submitted_name, ''), 'Chưa có tên'),
      'submittedName', r.submitted_name,
      'status', r.status,
      'requestedAt', r.requested_at
    ) order by r.requested_at desc)
    from public.customer_pin_reset_requests r
    left join public.customers c
      on c.owner_id = r.owner_id
      and public.normalize_vn_phone(c.phone) = r.customer_phone
    where r.owner_id = auth.uid()
      and r.status = 'pending'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.issue_customer_temporary_pin(
  p_request_id uuid,
  p_temporary_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.customer_pin_reset_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Vui lòng đăng nhập quản trị.'; end if;
  if coalesce(p_temporary_pin, '') !~ '^\d{6}$' then
    raise exception 'PIN tạm phải gồm đúng 6 số.';
  end if;

  select * into v_request
  from public.customer_pin_reset_requests
  where id = p_request_id
  for update;

  if v_request.id is null or v_request.owner_id <> auth.uid() then
    raise exception 'Không tìm thấy yêu cầu đặt lại PIN.';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Yêu cầu này đã được xử lý.';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(p_temporary_pin, extensions.gen_salt('bf')),
      updated_at = now()
  where id = v_request.customer_auth_id;

  if not found then raise exception 'Không tìm thấy tài khoản khách.'; end if;

  -- Hủy các phiên cũ để PIN mới có hiệu lực an toàn trên mọi thiết bị.
  delete from auth.sessions where user_id = v_request.customer_auth_id;

  insert into public.customer_pin_status (
    owner_id, customer_auth_id, must_change_pin, temporary_pin_issued_at, updated_at
  ) values (
    v_request.owner_id, v_request.customer_auth_id, true, now(), now()
  )
  on conflict (owner_id, customer_auth_id) do update set
    must_change_pin = true,
    temporary_pin_issued_at = excluded.temporary_pin_issued_at,
    updated_at = now();

  update public.customer_pin_reset_requests
  set status = 'issued', issued_at = now(), issued_by = auth.uid()
  where id = v_request.id;

  return jsonb_build_object(
    'success', true,
    'phone', v_request.customer_phone,
    'name', v_request.submitted_name
  );
end;
$$;

create or replace function public.get_customer_pin_status(p_shop_slug text default 'the-khe')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_must_change boolean := false;
begin
  if auth.uid() is null then raise exception 'Vui lòng đăng nhập.'; end if;

  select owner_id into v_owner_id
  from public.app_settings
  where public_order_slug = lower(trim(coalesce(p_shop_slug, 'the-khe')))
    and online_ordering_enabled = true
  limit 1;

  if v_owner_id is null then raise exception 'Cửa hàng chưa mở order online.'; end if;

  select must_change_pin into v_must_change
  from public.customer_pin_status
  where owner_id = v_owner_id and customer_auth_id = auth.uid();

  return jsonb_build_object('mustChangePin', coalesce(v_must_change, false));
end;
$$;

create or replace function public.complete_customer_pin_change(p_shop_slug text default 'the-khe')
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
begin
  if auth.uid() is null then raise exception 'Vui lòng đăng nhập.'; end if;

  select owner_id into v_owner_id
  from public.app_settings
  where public_order_slug = lower(trim(coalesce(p_shop_slug, 'the-khe')))
  limit 1;

  if v_owner_id is null then raise exception 'Không tìm thấy cửa hàng.'; end if;

  update public.customer_pin_status
  set must_change_pin = false, updated_at = now()
  where owner_id = v_owner_id and customer_auth_id = auth.uid();

  update public.customer_pin_reset_requests
  set status = 'completed', completed_at = now()
  where owner_id = v_owner_id
    and customer_auth_id = auth.uid()
    and status = 'issued';

  return true;
end;
$$;

revoke all on function public.request_customer_pin_reset(text, text, text) from public, anon, authenticated;
revoke all on function public.get_pin_reset_requests() from public, anon, authenticated;
revoke all on function public.issue_customer_temporary_pin(uuid, text) from public, anon, authenticated;
revoke all on function public.get_customer_pin_status(text) from public, anon, authenticated;
revoke all on function public.complete_customer_pin_change(text) from public, anon, authenticated;

grant execute on function public.request_customer_pin_reset(text, text, text) to anon, authenticated;
grant execute on function public.get_pin_reset_requests() to authenticated;
grant execute on function public.issue_customer_temporary_pin(uuid, text) to authenticated;
grant execute on function public.get_customer_pin_status(text) to authenticated;
grant execute on function public.complete_customer_pin_change(text) to authenticated;

-- Không có PIN nào được lưu ở bảng public. PIN tạm chỉ được băm trong auth.users.
