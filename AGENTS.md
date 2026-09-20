# Permudah — Agent Instructions

## Product

Permudah.id is an AI Workflow Commerce Platform.

Core principle:

> AI is the technology. Workflow is the product.

Permudah lets creators turn expertise, SOPs, knowledge, business logic, and AI capabilities into ready-to-use AI workflows/products that can be sold.

Initial flow:

Creator → Create Workflow → Publish → Storefront → Customer Purchase → Install to ChatGPT → Use

Creators bring the audience. Permudah provides the infrastructure.

## MVP

Primary user: Creator.

MVP must prove:

1. Creator can create a workflow.
2. Creator can publish it as a product.
3. Creator gets a storefront.
4. Creator can share the storefront/product URL.
5. Customer can purchase/access the product.
6. Customer can connect/install the workflow to ChatGPT.
7. Customer can use the workflow.
8. Creator can see basic revenue/usage.

Do not build a large marketplace, visual workflow builder, enterprise workspace system, or complex automation engine before this loop is validated.

## Workflow Model

Workflow uses a simple configuration model, conceptually similar to creating a Custom GPT, but Permudah is NOT a Custom GPT marketplace.

MVP workflow components:

- Identity
- Instructions
- Knowledge
- Inputs
- Tools
- Output

Do NOT build a visual node-based workflow editor for MVP.

A workflow is a technical asset. A Product is the commercial wrapper around a workflow.

Workflows are versioned.

Use JSON/JSONB for the workflow definition initially so the schema can evolve without premature normalization.

## ChatGPT Integration

ChatGPT is the first runtime/distribution channel, not the foundation of the business.

User-facing concept:

> Install to ChatGPT

Do not assume every workflow is a Custom GPT.

Prefer one Permudah ChatGPT App/MCP integration that can expose multiple purchased workflows rather than one integration per workflow.

Permudah owns:

- workflow definitions
- product/access rules
- entitlement
- business logic
- usage tracking
- creator commerce

ChatGPT provides the initial AI runtime.

Keep the architecture open for future Web/PWA/API/other runtimes.

Never hard-code core product logic around a temporary ChatGPT-specific mechanism.

## Architecture

Start as a modular monolith.

Preferred initial stack:

- Next.js
- React
- TypeScript
- PostgreSQL
- Drizzle ORM
- S3-compatible object storage
- TypeScript MCP
- Docker

Avoid introducing these in MVP unless a concrete requirement appears:

- FastAPI
- Redis
- RabbitMQ/Kafka
- Temporal
- n8n
- Kubernetes
- microservices

MCP and web interfaces should share domain/business logic instead of duplicating it.

Suggested repository direction:

apps/
  web/
  mcp/

packages/
  db/
  domain/
  workflow/
  auth/
  shared/

The exact structure can evolve with implementation needs.

## Domain Model

Initial core entities:

- User
- CreatorProfile
- Workflow
- WorkflowVersion
- Product
- Purchase
- Entitlement
- ChatGPTConnection
- WorkflowExecution

A User can be both creator and customer.

Creator-owned resources must always be scoped to the authenticated creator.

Purchase is a transaction record. Entitlement is access rights. Do not conflate them.

Creator storefront can initially be derived from creator profile/slug; avoid unnecessary storefront abstraction until needed.

## Security Rules

Never trust creator_id, user_id, price, ownership, or entitlement values sent by the browser.

Derive identity and ownership from authenticated server-side context.

Sensitive workflow logic, secrets, credentials, and business rules should remain server-side unless there is a concrete reason to expose them.

Payment success must be confirmed by trusted payment-provider webhook/server verification, not by browser state.

OAuth tokens/secrets must never be stored or logged in plaintext.

Validate uploaded knowledge files and enforce authorization before access.

## Engineering Principles

- Prefer simple solutions over abstract frameworks.
- Optimize for solo-developer speed and maintainability.
- Keep business logic framework-independent where practical.
- Avoid premature abstraction.
- Avoid premature normalization.
- Use explicit types and validation at boundaries.
- Preserve backward compatibility when changing workflow definitions.
- Add tests for important domain rules and regressions.
- Do not add dependencies without a concrete reason.
- Keep configuration through environment variables; never commit secrets.
- Make errors observable and actionable.

## Development Workflow

Before implementing a substantial feature:

1. Inspect the existing code and structure.
2. Identify the smallest change that proves the requirement.
3. Implement incrementally.
4. Run relevant tests/type checks/lint.
5. Update documentation when behavior or architecture changes.

Do not rewrite working code just to match a preferred architecture.

When uncertain between two approaches, prefer the one with less operational complexity unless the more complex option has a clear product or technical payoff.

## Current Product Direction

The next architectural topic after project setup is the concrete Workflow Definition schema.

Do not invent a large workflow engine before that design is settled.

## OpenCode Behavior

Act as a pragmatic senior engineer.

Challenge assumptions when they create unnecessary complexity or platform lock-in.

Separate:

- technically interesting
- commercially useful
- realistic for the MVP

When a requirement is ambiguous but a safe default is obvious, proceed with the simplest reasonable interpretation and document the assumption.

Keep implementation focused on validating the Permudah business loop.