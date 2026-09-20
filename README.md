# Permudah

Permudah.id is an AI Workflow Commerce Platform. Repository: Next.js 16 + TypeScript app in `apps/web`.

See [AGENTS.md](./AGENTS.md) for product and architecture guidance.

## Development

```bash
pnpm install
pnpm --filter web dev
```

## Deploying to Cloudflare

The app is a standard Next.js App Router build (`next build`). Use one of:

- **Cloudflare Pages** with the `@opennextjs/cloudflare` adapter (`opennextjs-cloudflare build`).
- **Cloudflare Workers** through the same OpenNext adapter when a Workers deployment is preferred.

The adapter is intentionally not installed yet; that is part of the landing-page deployment step.