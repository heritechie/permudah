-- Customers and entitlements (V0)

create table public.customers (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  status text not null default 'active',
  source text not null default 'free',
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entitlements_customer_id_workflow_id_unique unique (customer_id, workflow_id),
  constraint entitlements_status_check check (status in ('active', 'revoked', 'expired')),
  constraint entitlements_source_check check (source in ('free', 'grant'))
);

create index customers_email_idx on public.customers (email);
create index entitlements_customer_id_idx on public.entitlements (customer_id);
create index entitlements_workflow_id_idx on public.entitlements (workflow_id);
create index entitlements_status_idx on public.entitlements (status);

alter table public.customers enable row level security;
alter table public.entitlements enable row level security;

-- Customers can only read their own record.
create policy "customers_select_own" on public.customers
  for select to authenticated using (auth.uid () = id);

-- Customers can only insert their own record (matches their auth user id).
create policy "customers_insert_own" on public.customers
  for insert to authenticated with check (auth.uid () = id);

-- Customers can only update their own record.
create policy "customers_update_own" on public.customers
  for update to authenticated using (auth.uid () = id) with check (auth.uid () = id);

-- Entitlements can only be read by the owning customer.
-- Customers MUST NOT be able to insert or update entitlements; those operations
-- are reserved for trusted backend/processes (e.g., grant/admin flows) that run
-- outside the authenticated customer role.
create policy "entitlements_select_own" on public.entitlements
  for select to authenticated using (auth.uid () = customer_id);

-- Explicit table privileges. No anon access.
-- Customers get SELECT only on entitlements. INSERT/UPDATE/DELETE are not granted.
revoke all on public.customers from anon, authenticated;
revoke all on public.entitlements from anon, authenticated;

grant select, insert, update on public.customers to authenticated;
grant select on public.entitlements to authenticated;
