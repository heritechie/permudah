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
  - transaction: `state` + PKCE `code_verifier`, bound to the user id and cleared
    from the response before any validation outcome. It is **not** server-side
    single-use — see "Known limitations";
  - result: resource references for the result page, and the cookie signatures
    are purpose-separated so a result cookie can never be replayed as a
    transaction (or the reverse). This part *is* enforced server-side.
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

## Onboarding and the Apps Script API prerequisite

`/google` states the prerequisite before the user authorizes anything:

- **What you'll get** — four bullets, all future tense, and no tick marks.
  Nothing is ticked, claimed, or linked before provisioning succeeds, because
  none of those resources exist yet. The page never shows a resource id or a
  "ready" state.
- **Google setup** — the per-account Apps Script grant plus a single outbound
  link to `https://script.google.com/home/usersettings`, and "After enabling it,
  return here and continue."
- **Connect your account** — the main action, still `/api/google/auth`.

There is no client-side preflight check and none is possible: Permudah holds no
Google authorization before the user connects, so Google's API response is the
only source of truth. The page never claims to have verified anything.

### Two different 403s, two different states

Google returns a 403 for two unrelated Apps Script problems, and they need
opposite handling:

| Google response | Meaning | Reason | Who fixes it |
| --- | --- | --- | --- |
| `errors[0].reason: "forbidden"`, message "User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings then retry." | The account has not granted third-party apps access to its script projects | `apps_script_access_required` | The user, once |
| `errors[0].reason: "SERVICE_DISABLED"` / `ACCESS_NOT_CONFIGURED` | The API is not enabled on Permudah's Cloud project | `service_disabled` | Permudah's operator |

`kindFromHttpStatus` separates them: the explicit `SERVICE_DISABLED` /
`ACCESS_NOT_CONFIGURED` codes are checked first, so a Cloud-project fault always
wins even when the message also mentions the settings URL. Only then is the
canonical "user has not enabled the Apps Script API" sentence (or that exact
settings URL) matched. Only the boolean outcome is used — the message stays
server-side.

`apps_script_access_required` renders the user state: "Allow Apps Script access",
**Open Apps Script settings**, **Try again**, and "After enabling it, return here
and try again."

`service_disabled` deliberately does **not** offer the settings link. The user
cannot enable an API on Permudah's Cloud project, and pointing them at Google
Cloud would be both useless and a disclosure of our project layout. It renders a
generic "configuration problem on our side" message with the correlation
reference, and the Google code, status, and message stay in the sanitized server
log. The Google Cloud project number is extracted for that log line and is
**never sent to the browser** — not rendered, and not in the redirect URL. The
correlation id is the only identifier that crosses into the browser, and it is
the key an operator uses to find the project number in the log.

**Try again** points at `/api/google/auth`, never back at the callback. A retry
is therefore always a complete new authorization round trip with a new OAuth
state, a new PKCE verifier, and a new transaction cookie — no prior state,
verifier, or token is reused, and the previous access token existed only in the
failed request's memory.

The page only ever switches on a closed set of literal reason codes. An
unrecognised `?error=` value renders a generic message, `ref` is shape-validated
before rendering, and any other query parameter is ignored, so no raw Google
text can reach the page.

A failure redirect carries exactly two parameters: `?error=<fixed reason>&ref=<correlation id>`.

## Troubleshooting: "the API is not enabled yet"

Google reports a disabled API as a `403` whose `status` is the uninformative
`PERMISSION_DENIED`, with the actionable cause only in `errors[].reason`
(`SERVICE_DISABLED`, or `ACCESS_NOT_CONFIGURED` from Drive). The flow reads
every code, maps that pair to `service_disabled`, and tells the user Permudah has
a configuration problem plus a support reference, instead of telling them their
account lacks permission. The Google Cloud project number from the message goes
to the server log, not to the user.

Every Google API failure writes one structured log line: `correlationId`,
`operation`, HTTP `status`, the actionable `googleCode`, and a sanitized
`reason`. Sanitization redacts access tokens (`ya29.`), refresh tokens
(`1//`), authorization codes (`4/`), client secrets (`GOCSPX-`), `Bearer`
headers, and email addresses, and caps the length. Fields are allow-listed.
The `correlationId` in the log is the same value shown to the user as their
support reference, so a failed run can be traced without exposing anything
sensitive.

## Known limitations

### The OAuth transaction cookie is not server-side single-use

The OAuth transaction cookie is signed, short-lived, and bound to the
authenticated user. The transaction cookie is not server-side single-use in B1;
Google authorization codes remain single-use.

Concretely, the callback deletes the cookie from the response before any
validation outcome, so a normal browser never sends it twice. But there is no
durable consumed marker, so a second callback that presents the same cookie value
is re-validated rather than rejected. What actually bounds the impact today:

- The cookie is HMAC-signed, so it cannot be forged.
- It is bound to a `userId` that the current authenticated session must match, so
  only the same signed-in user can present it.
- It expires in 10 minutes.
- Google authorization codes are single-use, so a replayed exchange fails with
  `invalid_grant` and surfaces as `token_exchange_failed`.

B1 deliberately does not add replay-state infrastructure (no KV, no transaction
table, no `consumed_at` column). If replay defence is needed beyond the above,
the options are a consumed-marker in the database or a server-side store — both
are real schema/operational changes and are out of scope for this milestone.

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
- `apps/web/src/app/api/google/auth/route.test.ts` and `callback/route.test.ts` — authenticated start, user-bound callback, transaction-cookie clearing, fail-closed config, registry persistence and registry failure.
- `apps/web/src/lib/google/registry-migration.test.ts` — the migrations' RLS, grants, and `SECURITY DEFINER` properties.
- `apps/web/src/lib/google/registry-security.test.ts` — no elevated credential is referenced, the write is an RPC, and `userId` comes from the session.
- `apps/web/src/app/google/page.test.tsx` — anonymous redirect and actionable error copy.
- `apps/web/src/app/google/result/page.test.tsx` — token-free rendering, cross-user and tampered/expired references.
- `apps/mcp/test/google-boundary.test.ts` — the MCP Worker never touches Google.

Run with `pnpm --filter web test` and `pnpm --filter mcp test`. No test contacts
Google; live verification requires the credentials above.
