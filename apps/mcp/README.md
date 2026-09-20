# permudah-mcp (POC)

MCP server minimal untuk memvalidasi jalur distribusi **Permudah → ChatGPT (runtime AI)**.

POC ini hanya membuktikan satu hal:

> Sebuah MCP server di Cloudflare Workers dapat menyediakan tool yang bisa didaftarkan ke ChatGPT.

Belum ada integrasi DB, entitlement, pembayaran, atau pemanggilan model AI. Output tool bersifat **deterministik (mock)** — belum memakai LLM.

## Tool saat ini

`generate_instagram_carousel` — menghasilkan draf konten Instagram carousel (3 slide).

- Input: `topic`, `audience`, `tone` (semua string, wajib).
- Output (structured): `{ title, slides: [{ slide, headline, body }] }`.
- Deterministik: input sama → output selalu sama (tidak ada `Math.random`, `Date`, dsb).
- Validasi input via zod; input tidak valid → hasil `isError: true` (bukan JSON-RPC error).

## Mengapa arsitektur ini

- **Runtime**: Cloudflare Worker biasa (`apps/mcp`), terpisah dari `apps/web` (Next.js + vinext).
- **Transport**: `WebStandardStreamableHTTPServerTransport` dari `@modelcontextprotocol/sdk@1.30.0`
  (dokumentasi SDK: "Cloudflare Workers usage" — stateless mode `sessionIdGenerator: undefined`).
- **Stateless per-request**: setiap POST mendapat instance transport baru; tidak ada session state.
  Endpoint GET/SSE tidak disediakan (server tidak mengirim notifikasi keluar) → dikembalikan `405`,
  yang diharapkan oleh klien MCP (SDK client fallback ke POST-only).
- **CORS**: preflight OPTIONS → `204` (untuk MCP Inspector/alat berbasis browser).

## Struktur

```
apps/mcp/
  src/index.ts                     entry Worker (fetch handler, stateless transport)
  src/server.ts                    createMcpServer() — registrasi tool
  src/tools/instagram-carousel.ts  logika tool murni (deterministik, tanpa IO)
  test/instagram-carousel.test.ts  unit test (determinisme, validasi, skema)
  test/protocol.test.ts            test protokol via SDK client + raw Streamable HTTP
  wrangler.jsonc                   konfigurasi Worker
```

## Local dev

```bash
pnpm install                 # dari root repo
pnpm --filter mcp dev        # wrangler dev --port 8799
```

Smoke test (butuh header `Accept: application/json, text/event-stream`):

```bash
curl -s -X POST http://localhost:8799/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0.1.0"}}}'

curl -s -X POST http://localhost:8799/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

curl -s -X POST http://localhost:8799/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"generate_instagram_carousel","arguments":{"topic":"AI untuk UMKM","audience":"pemilik toko online","tone":"ramah"}}}'
```

## Test

```bash
pnpm --filter mcp test        # 21 test (unit + protokol)
pnpm --filter mcp lint        # tsc --noEmit
pnpm --filter mcp build       # tsc + wrangler deploy --dry-run (verifikasi bundle)
```

- Test protokol memakai klien MCP resmi (`@modelcontextprotocol/sdk` `Client` +
  `StreamableHTTPClientTransport`) terhadap handler Worker — handshake
  initialize → tools/list → tools/call seperti perilaku klien remote nyata.
- Bonus: test raw Streamable HTTP (SSE) langsung terhadap `workerHandler.fetch`.

## Deploy

```bash
pnpm --filter mcp deploy      # wrangler deploy
```

Endpoint publik: `https://permudah-mcp.<account-subdomain>.workers.dev/mcp`
(url `.../mcp` harus stabil).

## Registrasi di ChatGPT (Developer Mode)

> Status: langkah berikut sesuai dokumentasi resmi; **belum diverifikasi end-to-end**
> karena butuh akun ChatGPT + endpoint HTTPS ter-deploy. Jangan klaim sudah bekerja
> di ChatGPT hanya dari unit/protocol test.

Menurut dokumentasi ChatGPT MCP:

1. Deploy ke URL HTTPS publik yang stabil, diakhiri `/mcp`, speak Streamable HTTP.
   (Lokal `localhost` tidak bisa dipakai ChatGPT remote; gunakan `workerd` atau aplikasi
   desktop untuk testing lokal.)
2. Buka ChatGPT → **Settings → MCP servers → Add server**:
   - Name: `permudah-mcp`
   - Type: **Streamable HTTP**
   - URL: `https://permudah-mcp.<subdomain>.workers.dev/mcp`
   - Save → Restart ChatGPT (atau mulai sesi baru).
3. Server tanpa OAuth (mode anonymous/read-only) diperbolehkan selama tool server
   berbasis server dan tidak menyentuh data pengguna atas nama mereka.
   Tool yang bertindak atas nama pengguna **wajib OAuth 2.1 (DCR/CIMD)** — bukan Bearer.
4. Buka komposer, pilih MCP server (dynamic), panggil `generate_instagram_carousel`,
   isi `topic`/`audience`/`tone`.

Catatan literal dari hasil riset (bukan asumsi):
- ChatGPT mendukung STDIO dan Streamable HTTP server.
- Autentikasi: Bearer token, OAuth (DCR/CIMD), dan "chatgpt" session auth untuk first-party trusted.
- Server `instructions` dibaca saat initialization; tidak wajib.
- Verifikasi bahwa ChatGPT benar-benar bisa memanggil endpoint & tool harus dicek dengan
  akun sungguhan; POC ini belum melakukannya.

## Limitasi POC (sengaja)

- Tidak ada DB, entitlement, usage tracking, atau logika bisnis.
- Tool deterministik (mock) — bukan hasil LLM.
- Tanpa OAuth/DCR → hanya cocok untuk mode anonymous/dev; produksi perlu OAuth.
- Tanpa proteksi DNS-rebinding/origin di transport (default SDK, disabled
  untuk kemudahan dev; tambahkan middleware bila endpoint publik).
- Session state tidak dipakai (stateless) — client yang mengandalkan `mcp-session-id`
  akan tetap bekerja karena server tidak pernah mengirim header session.