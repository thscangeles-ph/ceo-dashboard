-- THSC Summary Dashboard: database setup.
-- Run in Supabase: Dashboard → SQL Editor → New query → paste this whole file → Run.
-- Safe to run again (also after an earlier version of this file): it only adds or updates what changed.
--
-- Account types (profiles.role)
--   'admin'     CEO / Doctor : everything, including sales reports, and Team (create accounts, set access).
--   'concierge' Concierge    : Patient CRM, with patient names and contact numbers. Add and update inquiries.
--   'marketing' Marketing    : read-only analytics of sales and the CRM, with patient names and numbers hidden.
--   null                     : signed in but no access yet.
-- Row Level Security enforces this in the database, not only in the app.

-- 1. Profiles ---------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Earlier versions called concierge accounts 'staff'.
alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'concierge' where role = 'staff';
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'concierge', 'marketing'));

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
-- Sales report line items.
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
drop policy if exists "inquiries: concierge and admins" on public.inquiries;
create policy "inquiries: concierge and admins" on public.inquiries
  for all to authenticated
  using (public.app_role() in ('admin', 'concierge'))
  with check (public.app_role() in ('admin', 'concierge'));

drop policy if exists "sales: admins only" on public.sales_rows;
create policy "sales: admins only" on public.sales_rows
  for all to authenticated
  using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

drop policy if exists "sheets: admins all, staff the CRM tracker" on public.sheets;
drop policy if exists "sheets: admins all, concierge the CRM tracker" on public.sheets;
create policy "sheets: admins all, concierge the CRM tracker" on public.sheets
  for all to authenticated
  using (public.app_role() = 'admin' or (public.app_role() = 'concierge' and kind = 'concierge'))
  with check (public.app_role() = 'admin' or (public.app_role() = 'concierge' and kind = 'concierge'));

drop policy if exists "sheets: marketing reads" on public.sheets;
create policy "sheets: marketing reads" on public.sheets
  for select to authenticated using (public.app_role() = 'marketing');

-- 3. De-identified views for Marketing -------------------------------------
-- Same rows, but the patient name becomes a short code and the contact number is removed, so
-- Marketing can count patients and measure channels without seeing who they are. The views run as
-- their owner, so the WHERE clause is what limits them to Marketing (and admins, for checking).
create or replace view public.inquiries_marketing as
  select key,
         data - 'contact' - 'patient'
           || jsonb_build_object(
                'patient', 'Patient ' || upper(left(md5(coalesce(nullif(regexp_replace(data ->> 'contact', '\D', '', 'g'), ''), lower(data ->> 'patient'), key)), 6)),
                'contact', '') as data
  from public.inquiries
  where public.app_role() in ('marketing', 'admin');

create or replace view public.sales_marketing as
  select key, data || jsonb_build_object('patient', md5(coalesce(data ->> 'patient', key))) as data
  from public.sales_rows
  where public.app_role() in ('marketing', 'admin');

-- Only signed-in users reach these; RLS and the view filters decide what each one sees.
revoke all on public.profiles, public.inquiries, public.sales_rows, public.sheets, public.inquiries_marketing, public.sales_marketing from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.inquiries, public.sales_rows, public.sheets to authenticated;
grant select on public.inquiries_marketing, public.sales_marketing to authenticated;

-- 4. Make yourself the first CEO / Doctor (admin) ---------------------------
-- After creating your own user (Authentication → Users → Add user), run this
-- with your email. Everyone else can then be added from the app (Team → Add person).
--
--   update public.profiles set role = 'admin' where email = 'you@example.com';
