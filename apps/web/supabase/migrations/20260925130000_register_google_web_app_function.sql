-- Google Web App registry write path (Milestone B1)
--
-- Replaces the service-role insert with a narrowly scoped SECURITY DEFINER
-- function. Rationale: a Supabase service-role key bypasses RLS on EVERY table
-- in the database. Granting the application that key so it can perform one
-- INSERT into one table is a much larger grant than the feature needs. This
-- function is the least-privilege alternative: the caller keeps its ordinary
-- `authenticated` role and its own JWT, and the only elevated capability in the
-- system is "insert one row into public.google_web_apps, and only for myself".
--
-- Properties that make this safe:
--
--   * SECURITY DEFINER, so the INSERT runs as the function owner. The owner is
--     the same role that created the table, so RLS does not apply to the INSERT
--     while RLS still governs every other path.
--   * The owner check compares p_user_id against auth.uid() and the INSERT uses
--     the verified uid, never the caller's argument. A mismatch raises, so a user
--     cannot register an install for someone else even by calling the function
--     directly.
--   * One static INSERT. No UPDATE, no DELETE, no SELECT, and no dynamic SQL
--     (no EXECUTE anywhere in the body), so the function cannot be steered at
--     another table.
--   * `set search_path = public, pg_temp` pins object resolution. pg_temp is
--     listed explicitly and last so a caller's temporary objects cannot shadow
--     the table, and the target table is written as public.google_web_apps
--     regardless.
--   * EXECUTE is revoked from PUBLIC (which covers anon and every other role)
--     and granted only to `authenticated`. Because the body also requires
--     auth.uid() to be non-null, an anonymous caller is rejected at the first
--     check even though `authenticated` is the only role with EXECUTE.
--
-- PostgREST exposes this as the RPC `register_google_web_app`, which the server
-- calls with the user's own session. The browser still has no INSERT, UPDATE, or
-- DELETE privilege on the table: this function is the only write path.

create or replace function public.register_google_web_app(
  p_user_id uuid,
  p_spreadsheet_id text,
  p_script_id text,
  p_deployment_id text,
  p_web_app_url text,
  p_owner_email text,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row_id uuid;
  v_value text;
begin
  -- 1. Reject an unauthenticated caller outright.
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  -- 2. Reject a missing identity and reject any attempt to write on behalf of
  --    another user.
  if p_user_id is null or p_user_id is distinct from v_user_id then
    raise exception 'user id does not match the authenticated user' using errcode = '42501';
  end if;

  -- 3. Reject missing or absurdly large values before they reach the table.
  foreach v_value in array array[
    p_spreadsheet_id,
    p_script_id,
    p_deployment_id,
    p_web_app_url,
    p_owner_email
  ]
  loop
    if v_value is null or btrim(v_value) = '' or length(v_value) > 512 then
      raise exception 'invalid value for a required argument' using errcode = '22023';
    end if;
  end loop;

  -- 4. The single write. The owner is the verified uid, not p_user_id.
  insert into public.google_web_apps (
    user_id,
    spreadsheet_id,
    script_id,
    deployment_id,
    web_app_url,
    owner_email,
    status
  )
  values (
    v_user_id,
    p_spreadsheet_id,
    p_script_id,
    p_deployment_id,
    p_web_app_url,
    p_owner_email,
    coalesce(nullif(btrim(p_status), ''), 'active')
  )
  returning id into v_row_id;

  return v_row_id;
end;
$$;

-- Lock the function down before granting anything. PUBLIC is the implicit
-- default for every role, including anon, so this revoke is what actually
-- removes the anonymous call path.
revoke all on function public.register_google_web_app(uuid, text, text, text, text, text, text) from public;

-- The only caller: an authenticated Permudah user, through the server's RPC.
grant execute on function public.register_google_web_app(uuid, text, text, text, text, text, text) to authenticated;

-- Explicitly no EXECUTE for anon, and no table write privilege for either role.
revoke all on function public.register_google_web_app(uuid, text, text, text, text, text, text) from anon;
revoke insert, update, delete on public.google_web_apps from anon, authenticated;
