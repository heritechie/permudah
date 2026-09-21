-- Platform publisher (Milestone A)
--
-- Adds a publisher type to creators so Permudah itself can own workflows
-- without creating a fake Supabase auth user.
--
--   creator  - a normal human creator (existing behavior)
--   platform - a first-party Permudah publisher (no auth user, no login)
--
-- The platform publisher is seeded with a deterministic UUID:
--   b2da1210-548d-5ff1-9245-ae91d73a357b
-- (SHA-1 v5 of "platform-publisher" in the DNS namespace). Re-running this
-- migration is safe: every statement below is idempotent.

-- 1. Add the type column. Existing rows default to 'creator'.
alter table public.creators
  add column if not exists type text not null default 'creator';

-- 2. Bound type to the allowed set.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'creators_type_check'
  ) then
    alter table public.creators
      add constraint creators_type_check check (type in ('creator', 'platform'));
  end if;
end
$$;

-- 3. Index on type for future storefront/catalog filtering.
create index if not exists creators_type_idx on public.creators (type);

-- 4. The platform publisher has no auth.users row (no email, no password, no
--    login). creators.id can no longer be constrained to auth.users.id.
--    Ownership for human creators is still enforced by RLS (auth.uid() = id),
--    so dropping this FK does not weaken access control.
alter table public.creators
  drop constraint if exists creators_id_fkey;

-- 5. RLS hardening: authenticated users may only insert/update a creator row
--    that is their own (auth.uid() = id) AND has type = 'creator'. No normal
--    user can ever create or promote a 'platform' publisher through the API.
drop policy if exists creators_insert_own on public.creators;
create policy "creators_insert_own" on public.creators
  for insert to authenticated
  with check (auth.uid () = id and type = 'creator');

drop policy if exists creators_update_own on public.creators;
create policy "creators_update_own" on public.creators
  for update to authenticated
  using (auth.uid () = id)
  with check (auth.uid () = id and type = 'creator');

-- 6. Seed the official Permudah publisher. Idempotent: the deterministic UUID
--    means a second run conflicts on the primary key and does nothing.
insert into public.creators (id, slug, display_name, bio, avatar_url, type)
values (
  'b2da1210-548d-5ff1-9245-ae91d73a357b',
  'permudah',
  'Permudah Official',
  'Official workflows by Permudah.',
  null,
  'platform'
)
on conflict (id) do nothing;

-- 7. Expose creator type on the public storefront view so domain code can
--    represent type explicitly without ever exposing auth data. The view does
--    not join auth.users; it only reads columns off public.creators.
drop view if exists public.creator_storefronts;
create view public.creator_storefronts
with (security_invoker = false) as
select
  id,
  slug,
  display_name,
  bio,
  avatar_url,
  type,
  updated_at
from public.creators;

grant select on public.creator_storefronts to anon, authenticated;