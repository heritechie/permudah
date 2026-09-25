# Milestone B1 — Permudah provisions user-owned Google resources

Status: implemented and unit-tested. Live Google verification is pending credentials.

## What the flow proves

A creator signs in to Permudah, connects their own Google account, and Permudah
creates, in the creator's own Google account:

1. a Google Spreadsheet,
2. an Apps Script project bound to that Spreadsheet,
3. a Web App deployment of that script that returns **Hello from Permudah**.

Nothing is created inside a Permudah-owned Google account. There is no service
account, no shared drive, and no browser automation. Google identity comes from
Google OAuth (`userinfo`) and is bound to the authenticated Permudah user, so the
same flow is what proves identity later for Sheets/Docs/Slides connections.

## Request flow

| Step | Entry point |
| --- | --- |
| 1 | `GET /google` renders the connect page (requires an authenticated Permudah session) |
| 2 | `GET /api/google/auth` builds the Google authorization URL, PKCE verifier, and signed transaction cookie |
| 3 | Google redirects to `GET /api/google/callback` |
| 4 | The callback exchanges the code, verifies identity and ownership, provisions resources, and redirects to `/google/result` |
| 5 | `/google/result` renders the result from a short-lived signed cookie |

Only steps 2–4 run on the server. The browser never sees a Google token, resource
id, or email in a URL.

## Google API calls (all with the user's own access token)

| Call | Purpose |
| --- | --- |
| `POST https://www.googleapis.com/drive/v3/files` | create the Spreadsheet |
| `GET https://www.googleapis.com/drive/v3/files/{id}?fields=owners` | confirm the new Spreadsheet is owned by the connecting account |
| `DELETE https://www.googleapis.com/drive/v3/files/{id}` | best-effort cleanup if a later step fails |
| `POST https://script.googleapis.com/v1/projects` | create the script with `parentId` = Spreadsheet id |
| `PUT https://script.googleapis.com/v1/projects/{id}/content` | write `Code.gs`, `index.html`, `appsscript.json` |
| `POST https://script.googleapis.com/v1/projects/{id}/versions` | create version 1 |
| `POST https://script.googleapis.com/v1/projects/{id}/deployments` | create the Web App deployment |
| `GET https://openidconnect.googleapis.com/v1/userinfo` | Google identity (subject, email, verification) |

## Scopes and why

| Scope | Why |
| --- | --- |
| `openid` | stable Google subject, the real identity key |
| `email` | ownership confirmation against the created Spreadsheet |
| `https://www.googleapis.com/auth/drive.file` | create and read only files the app creates; no access to existing Drive files |
| `https://www.googleapis.com/auth/script.projects` | create and update the bound Apps Script project |
| `https://www.googleapis.com/auth/script.deployments` | create the Web App deployment |

`drive.file` is intentionally narrow: the flow cannot read, list, or modify the
creator's other files. If an API scope grant is reduced by the user, the callback
rejects the run with `insufficient_scope` instead of partially provisioning.

The three `https://www.googleapis.com/auth/...` scopes are the only ones checked
against the token response `scope` field, compared as exact strings.
`openid` and `email` are requested but are not reported there (they authorize an
ID token, not API access), so they are proven by the `userinfo` call instead
(`sub`, `email`, `email_verified`). A token response that omits `scope` entirely
means granted == requested and is accepted.

## Ownership and security rules

- The deployment manifest uses `executeAs: "USER_DEPLOYING"` and
  `access: "MYSELF"`, so Permudah cannot execute the Web App on the creator's
  behalf and the app is not published to `anyone`.
- The Spreadsheet owner list must contain the OAuth email (case-insensitive),
  otherwise the run aborts and the Spreadsheet is trashed.
- The script project must report the created Spreadsheet as its `parentId`.
- Google credentials never reach the browser, the URL, logs, Supabase, or the
  MCP Worker. The access token lives only in callback memory; no `refresh_token`
  is requested or read (`access_type=online`).
- Two HttpOnly, `SameSite=Lax`, 10-minute cookies are HMAC-SHA256 signed with
  `GOOGLE_OAUTH_COOKIE_SECRET` and bound to the Permudah user id:
  - transaction: `state` + PKCE `code_verifier`, single use, consumed before
    validation so it cannot be replayed;
  - result: resource references for the result page, and the transaction
    signature is purpose-separated so a result cookie can never be replayed as a
    transaction (or the reverse).
- The result page re-verifies the signature, the TTL, the user id, and the Google
  URL host before rendering anything.
- `GOOGLE_OAUTH_REDIRECT_URI` is required and must be `https` in production, so a
  spoofed `Host` header cannot influence the OAuth redirect. Any missing or short
  configuration fails closed with `missing_config`.
- Unverified Google emails are rejected (`unverified_email`).
- A successful install is recorded in `public.google_web_apps`
  (`apps/web/supabase/migrations/20260925120000_google_web_app_registry.sql`).
  It stores resource identifiers only: no access token, refresh token,
  authorization code, or client secret.
- The registry write is a narrowly scoped `SECURITY DEFINER` Postgres function,
  `register_google_web_app` (migration `20260925130000`). The application holds
  no elevated credential: the server calls the function over PostgREST RPC with
  the user's own session, and the database re-derives the owner from the JWT
  with `auth.uid()`. A service-role key was rejected here because it bypasses RLS
  on *every* table, not just this one.
- The function inserts exactly one row and nothing else: no `UPDATE`, no
  `DELETE`, no `SELECT`, and no dynamic SQL, so it cannot be aimed at another
  table. It pins `search_path = public, pg_temp` and writes to
  `public.google_web_apps` explicitly. `EXECUTE` is revoked from `PUBLIC`
  (which is what actually removes the anonymous call path) and granted only to
  `authenticated`.
- RLS stays enabled and browser policies stay SELECT-own only. There is no
  browser `INSERT`, `UPDATE`, or `DELETE` policy and no write grant for `anon`
  or `authenticated`; the function is the only write path.
- A registry failure is reported to the user and never triggers deletion of the
  Google resources they just created, and it never happens before provisioning
  succeeded. The browser sees a fixed reason, never a database message.

## Troubleshooting: "the API is not enabled yet"

Google reports a disabled API as a `403` whose `status` is the uninformative
`PERMISSION_DENIED`, with the actionable cause only in `errors[].reason`
(`SERVICE_DISABLED`, or `ACCESS_NOT_CONFIGURED` from Drive). The flow reads
every code, maps that pair to `service_disabled`, and shows the user the Google
Cloud project number from the message plus a support reference, instead of
telling them their account lacks permission.

Every Google API failure writes one structured log line: `correlationId`,
`operation`, HTTP `status`, the actionable `googleCode`, and a sanitized
`reason`. Sanitization redacts access tokens (`ya29.`), refresh tokens
(`1//`), authorization codes (`4/`), client secrets (`GOCSPX-`), `Bearer`
headers, and email addresses, and caps the length. Fields are allow-listed.
The `correlationId` in the log is the same value shown to the user as their
support reference, so a failed run can be traced without exposing anything
sensitive.

## Setup

1. In Google Cloud Console, enable the **Google Drive API**, **Google Apps Script API**, and **Google Sheets API**.
2. Configure the OAuth consent screen. While the app is in *Testing*, add the target Google account as a test user.
3. Create an OAuth 2.0 Client ID of type **Web application** and register the exact redirect URI, e.g. `https://your-domain.com/api/google/callback`.
4. Copy `apps/web/.env.example` to `apps/web/.env.local` and fill in:

   | Variable | Notes |
   | --- | --- |
   | `GOOGLE_OAUTH_CLIENT_ID` | from the OAuth client |
   | `GOOGLE_OAUTH_CLIENT_SECRET` | server-only |
   | `GOOGLE_OAUTH_REDIRECT_URI` | absolute, `https` in production |
   | `GOOGLE_OAUTH_COOKIE_SECRET` | `openssl rand -base64 32`, at least 32 characters |

   For the Cloudflare Workers deployment set the same value as a Worker secret:
   `pnpm --filter web exec wrangler secret put GOOGLE_OAUTH_COOKIE_SECRET`.

   There is no service-role key, and none is needed: the registry write uses the
   user's own session.

5. Apply both registry migrations so the table and the write function exist:
   `supabase db push` (or apply `20260925120000_google_web_app_registry.sql` and
   `20260925130000_register_google_web_app_function.sql`).
6. Sign in to Permudah, open `/google`, and click **Connect Google**.

### Verifying the write path against a real database

The security tests read the migration SQL, because the unit test environment has
no database. Before relying on it, run these once against a real project:

```sql
-- must fail: a user cannot register an install for someone else
select register_google_web_app(
  '<other-uuid>', 'sheet', 'script', 'dep',
  'https://script.google.com/macros/s/abc/exec', 'a@example.com', 'active');

-- must fail: an anonymous caller has no EXECUTE
set local role anon;
select register_google_web_app(
  '<some-uuid>', 'sheet', 'script', 'dep',
  'https://script.google.com/macros/s/abc/exec', 'a@example.com', 'active');
```

## Architecture gap: ChatGPT / MCP is not wired to this

`apps/mcp` is a separate Cloudflare Worker. It authenticates requests with a
Supabase bearer token and has no Google credential, so it cannot provision
Google resources. `apps/mcp/test/google-boundary.test.ts` guards this boundary.

The POC intentionally uses a one-shot, online Google access token that only
exists during the callback. An MCP tool such as `create_google_web_app` would
require durable per-user Google connections before it can be added safely:

- a private `google_connections` table in Supabase with RLS scoped to the user,
- envelope-encrypted refresh tokens (KMS or secret manager), never plaintext,
- revocation and expiry handling, and reconnect flows,
- one shared server-side provisioning service used by both web and MCP, with the
  user id taken only from the authenticated context.

Until those exist, provisioning stays in the web app where the OAuth callback
already runs.

## Tests

- `apps/web/src/lib/google/*.test.ts` — PKCE/state, token parsing, error mapping, ownership, deployment manifest, orchestration order and cleanup, signed cookies, structured logging, and the registry.
- `apps/web/src/app/api/google/auth/route.test.ts` and `callback/route.test.ts` — authenticated start, user-bound callback, single-use transaction, fail-closed config, registry persistence and registry failure.
- `apps/web/src/lib/google/registry-migration.test.ts` — the migrations' RLS, grants, and `SECURITY DEFINER` properties.
- `apps/web/src/lib/google/registry-security.test.ts` — no elevated credential is referenced, the write is an RPC, and `userId` comes from the session.
- `apps/web/src/app/google/page.test.tsx` — anonymous redirect and actionable error copy.
- `apps/web/src/app/google/result/page.test.tsx` — token-free rendering, cross-user and tampered/expired references.
- `apps/mcp/test/google-boundary.test.ts` — the MCP Worker never touches Google.

Run with `pnpm --filter web test` and `pnpm --filter mcp test`. No test contacts
Google; live verification requires the credentials above.
