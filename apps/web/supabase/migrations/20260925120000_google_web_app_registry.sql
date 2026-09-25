-- Google Web App registry (Milestone B1)
--
-- Records the Google resources Permudah successfully provisioned inside a
-- USER's own Google account: the Spreadsheet, the Apps Script project bound to
-- it, the Web App deployment, and the deployed URL.
--
-- Why this table exists: before it, a provisioned web app existed only in a
-- 10-minute signed cookie, so Permudah could not show, redeploy, update, or
-- support it. The row is the durable link between a Permudah user and the
-- resources in their Drive.
--
-- Secrets policy: this table stores resource identifiers and a deployment URL
-- only. Access tokens, refresh tokens, and OAuth authorization codes must never
-- be written here; Google credentials are never persisted by Permudah.
--
-- Access control:
--   - A user may SELECT only their own rows.
--   - No INSERT/UPDATE/DELETE policy exists and no write privilege is granted
--     to anon/authenticated, so a browser client can never write a row, even
--     with the user's own session.
--   - There is deliberately no service_role grant. A service-role key bypasses
--     RLS on every table, which is far more privilege than recording one install
--     requires. The only write path is the SECURITY DEFINER function
--     register_google_web_app(), created in the next migration, which the
--     authenticated server calls through RPC. This mirrors the entitlement
--     model in customers_and_entitlements.sql.

create table if not exists public.google_web_apps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  spreadsheet_id text not null,
  script_id text not null,
  deployment_id text not null,
  web_app_url text not null,
  owner_email text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A Google Apps Script project and deployment are globally unique, so a
  -- duplicate row would mean the same install was recorded twice.
  constraint google_web_apps_script_id_unique unique (script_id),
  constraint google_web_apps_deployment_id_unique unique (deployment_id),
  constraint google_web_apps_status_check check (status in ('active', 'failed', 'disabled'))
);

create index if not exists google_web_apps_user_id_idx on public.google_web_apps (user_id);
create index if not exists google_web_apps_status_idx on public.google_web_apps (status);

alter table public.google_web_apps enable row level security;

-- Owners may read their own installs so their account page can list them.
drop policy if exists google_web_apps_select_own on public.google_web_apps;
create policy "google_web_apps_select_own" on public.google_web_apps
  for select to authenticated using (auth.uid () = user_id);

-- No insert/update/delete policies: RLS denies every client write. Combined
-- with the privilege revocation below, a browser cannot write even as the
-- owning user.

-- Explicit table privileges. No anon access, no client writes. The write path
-- is the SECURITY DEFINER function in the next migration, not a table grant.
revoke all on public.google_web_apps from anon, authenticated;

grant select on public.google_web_apps to authenticated;
