-- THSC CEO Dashboard: database setup.
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste this file → Run.
-- Safe to run again; it only creates what is missing.
--
-- Access model
--   * Every login gets a profile with NO access until an admin gives it a role.
--   * role 'staff' : Patient CRM (inquiries) — read, add, update, delete.
--   * role 'admin' : everything, including sales reports, plus giving people access in the app (Team).
--   Row Level Security enforces this in the database, not just in the app.

-- 1. Profiles ---------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text check (role in ('admin', 'staff')), -- null = no access yet
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- The signed-in user's role. SECURITY DEFINER so policies can call it without recursing into RLS.
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;
revoke all on function public.app_role() from public;
grant execute on function public.app_role() to authenticated;

drop policy if exists "profiles: read own, admins read all" on public.profiles;
create policy "profiles: read own, admins read all" on public.profiles
  for select to authenticated using (id = auth.uid() or public.app_role() = 'admin');

drop policy if exists "profiles: admins change roles" on public.profiles;
create policy "profiles: admins change roles" on public.profiles
  for update to authenticated using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

-- New logins get a profile automatically (with no access).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles for users created before this script ran.
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- 2. Shared data ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); new.updated_by = auth.uid(); return new; end;
$$;

-- Patient CRM: one row per inquiry from the scheduling tracker or logged in the app.
create table if not exists public.inquiries (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
-- Sales report line items (admins only).
create table if not exists public.sales_rows (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
-- Which workbook sheets were loaded.
create table if not exists public.sheets (
  key text primary key,
  kind text not null check (kind in ('sales', 'concierge')),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

do $$
declare t text;
begin
  foreach t in array array['inquiries', 'sales_rows', 'sheets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop trigger if exists touch_%1$s on public.%1$I', t);
    execute format('create trigger touch_%1$s before insert or update on public.%1$I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

drop policy if exists "inquiries: staff and admins" on public.inquiries;
create policy "inquiries: staff and admins" on public.inquiries
  for all to authenticated
  using (public.app_role() in ('admin', 'staff'))
  with check (public.app_role() in ('admin', 'staff'));

drop policy if exists "sales: admins only" on public.sales_rows;
create policy "sales: admins only" on public.sales_rows
  for all to authenticated
  using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

drop policy if exists "sheets: admins all, staff the CRM tracker" on public.sheets;
create policy "sheets: admins all, staff the CRM tracker" on public.sheets
  for all to authenticated
  using (public.app_role() = 'admin' or (public.app_role() = 'staff' and kind = 'concierge'))
  with check (public.app_role() = 'admin' or (public.app_role() = 'staff' and kind = 'concierge'));

-- Only signed-in users reach these tables; RLS above decides what each one sees.
revoke all on public.profiles, public.inquiries, public.sales_rows, public.sheets from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.inquiries, public.sales_rows, public.sheets to authenticated;

-- 3. Make yourself the first admin ------------------------------------------
-- After creating your own user (Authentication → Users → Add user), run this
-- with your email. Everyone else can then be given access from the app (Team).
--
--   update public.profiles set role = 'admin' where email = 'you@example.com';
