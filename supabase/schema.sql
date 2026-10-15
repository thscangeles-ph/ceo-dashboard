-- THSC Summary Dashboard: database setup.
-- Run in Supabase: Dashboard → SQL Editor → New query → paste this whole file → Run.
-- Safe to run again (also after an earlier version of this file): it only adds or updates what changed.
--
-- Account types (profiles.role)
--   'admin'     Admin        : everything, including the team's sales reports, and Team (create accounts, set access).
--   'mancom'    ManCom       : everything, same as Admin.
--   'doctor'    Doctors      : everything, same as Admin.
--   'concierge' Concierge    : Patient CRM, with patient names and contact numbers. Add and update inquiries.
--   'marketing' Marketing    : read-only Patient Acquisition Cost and CRM, with patient names and numbers hidden,
--                              plus their own Sales Dashboard files.
-- Every account with sales access has its own Sales Dashboard files (personal_sales), seen only by them.
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
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'mancom', 'doctor', 'concierge', 'marketing'));

-- The signed-in user's role. SECURITY DEFINER so policies can call it without recursing into RLS.
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;
revoke all on function public.app_role() from public;
grant execute on function public.app_role() to authenticated;

-- Admin, ManCom and Doctors all have full access.
create or replace function public.full_access()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.app_role() in ('admin', 'mancom', 'doctor'), false) $$;
revoke all on function public.full_access() from public;
grant execute on function public.full_access() to authenticated;

drop policy if exists "profiles: read own, admins read all" on public.profiles;
create policy "profiles: read own, admins read all" on public.profiles
  for select to authenticated using (id = auth.uid() or public.full_access());

drop policy if exists "profiles: admins change roles" on public.profiles;
create policy "profiles: admins change roles" on public.profiles
  for update to authenticated using (public.full_access()) with check (public.full_access());

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
  using (public.full_access() or public.app_role() = 'concierge')
  with check (public.full_access() or public.app_role() = 'concierge');

-- Steps taken on an inquiry (data -> 'actionLog') can be added by Concierge but only removed by
-- Admin, ManCom or Doctors, who are also the only ones who can delete an inquiry.
create or replace function public.protect_inquiry_steps()
returns trigger language plpgsql set search_path = public
as $$
begin
  if public.full_access() or auth.uid() is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Only an Admin, ManCom or Doctors account can delete an inquiry.' using errcode = '42501';
  end if;
  if not (coalesce(new.data -> 'actionLog', '[]'::jsonb) @> coalesce(old.data -> 'actionLog', '[]'::jsonb)) then
    raise exception 'Steps already recorded on an inquiry can only be removed by an Admin, ManCom or Doctors account.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_inquiry_steps on public.inquiries;
create trigger protect_inquiry_steps before update or delete on public.inquiries
  for each row execute function public.protect_inquiry_steps();

drop policy if exists "sales: admins only" on public.sales_rows;
create policy "sales: admins only" on public.sales_rows
  for all to authenticated
  using (public.full_access())
  with check (public.full_access());

drop policy if exists "sheets: admins all, staff the CRM tracker" on public.sheets;
drop policy if exists "sheets: admins all, concierge the CRM tracker" on public.sheets;
create policy "sheets: admins all, concierge the CRM tracker" on public.sheets
  for all to authenticated
  using (public.full_access() or (public.app_role() = 'concierge' and kind = 'concierge'))
  with check (public.full_access() or (public.app_role() = 'concierge' and kind = 'concierge'));

drop policy if exists "sheets: marketing reads" on public.sheets;
create policy "sheets: marketing reads" on public.sheets
  for select to authenticated using (public.app_role() = 'marketing');

-- Personal Sales Dashboards: each account's own sales report files, which nobody else can read.
-- (The shared sales_rows above are the team's reports behind Patient Acquisition Cost.)
create table if not exists public.personal_sales (
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null,
  kind text not null check (kind in ('row', 'sheet')),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner, key)
);
alter table public.personal_sales enable row level security;
drop policy if exists "personal sales: own files only" on public.personal_sales;
create policy "personal sales: own files only" on public.personal_sales
  for all to authenticated
  using (owner = auth.uid() and (public.full_access() or public.app_role() = 'marketing'))
  with check (owner = auth.uid() and (public.full_access() or public.app_role() = 'marketing'));

-- Live updates: the Inquiry Tracker and CRM refresh on everyone's screen when an inquiry changes.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inquiries') then
    execute 'alter publication supabase_realtime add table public.inquiries';
  end if;
end $$;

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
  where public.app_role() = 'marketing' or public.full_access();

create or replace view public.sales_marketing as
  select key, data || jsonb_build_object('patient', md5(coalesce(data ->> 'patient', key))) as data
  from public.sales_rows
  where public.app_role() = 'marketing' or public.full_access();

-- Only signed-in users reach these; RLS and the view filters decide what each one sees.
revoke all on public.profiles, public.inquiries, public.sales_rows, public.sheets, public.personal_sales, public.inquiries_marketing, public.sales_marketing from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.inquiries, public.sales_rows, public.sheets, public.personal_sales to authenticated;
grant select on public.inquiries_marketing, public.sales_marketing to authenticated;

-- 4. Make yourself the first Admin -------------------------------------------
-- After creating your own user (Authentication → Users → Add user), run this
-- with your email. Everyone else can then be added from the app (Team → Add person).
--
--   update public.profiles set role = 'admin' where email = 'you@example.com';
