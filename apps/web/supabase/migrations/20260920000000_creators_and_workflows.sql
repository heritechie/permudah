-- Creators and workflows

create table public.creators (
  id uuid primary key references auth.users (id) on delete cascade,
  slug text not null unique,
  display_name text not null,
  bio text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators (id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  status text not null default 'draft',
  draft_definition jsonb not null default '{}'::jsonb,
  published_definition jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint workflows_creator_id_slug_unique unique (creator_id, slug),
  constraint workflows_status_check check (status in ('draft', 'published', 'archived'))
);

create index workflows_status_idx on public.workflows (status);
create index workflows_created_at_idx on public.workflows (created_at desc);

alter table public.creators enable row level security;
alter table public.workflows enable row level security;

-- A creator record belongs to the authenticated user it references.
create policy "creators_select_own" on public.creators
  for select to authenticated using (auth.uid () = id);

create policy "creators_insert_own" on public.creators
  for insert to authenticated with check (auth.uid () = id);

create policy "creators_update_own" on public.creators
  for update to authenticated using (auth.uid () = id) with check (auth.uid () = id);

-- Workflows are owned by the creator record, whose id is the auth user id.
create policy "workflows_select_own" on public.workflows
  for select to authenticated using (auth.uid () = creator_id);

create policy "workflows_insert_own" on public.workflows
  for insert to authenticated with check (auth.uid () = creator_id);

create policy "workflows_update_own" on public.workflows
  for update to authenticated using (auth.uid () = creator_id) with check (auth.uid () = creator_id);

create policy "workflows_delete_own" on public.workflows
  for delete to authenticated using (auth.uid () = creator_id);

-- Explicit table privileges. A fresh database gets the same permissions as the
-- production database. Authenticated is granted the app CRUD set only, so as
-- TRUNCATE, TRIGGER and REFERENCES remain revoked.
revoke all on public.creators from anon, authenticated;
revoke all on public.workflows from anon, authenticated;

grant select, insert, update on public.creators to authenticated;
grant select, insert, update, delete on public.workflows to authenticated;

-- Public-facing surface. Security definer views expose only the fields the
-- storefront needs and never the private creator/creator context.
create view public.creator_storefronts
with (security_invoker = false) as
select
  id,
  slug,
  display_name,
  bio,
  avatar_url,
  updated_at
from public.creators;

create view public.public_workflows
with (security_invoker = false) as
select
  id,
  creator_id,
  slug,
  name,
  description,
  published_definition,
  published_at,
  updated_at
from public.workflows
where status = 'published'
  and published_definition is not null;

grant select on public.creator_storefronts to anon, authenticated;
grant select on public.public_workflows to anon, authenticated;