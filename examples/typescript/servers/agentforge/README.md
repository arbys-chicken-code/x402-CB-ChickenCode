# AgentForge Intelligence Suite

> A production-ready, **pay-per-call multi-service MCP + HTTP API** product for AI agents, built on the [x402](https://github.com/x402-foundation/x402) payment protocol and designed to be listed on **[Agentic.market](https://agentic.market)**.

AgentForge takes the official x402 MCP example (one paid `get_weather` tool) and grows it into a complete, sellable product: **eight high-value intelligence services**, each callable **both as an MCP tool** (for agent frameworks) **and as a REST endpoint**, with per-call USDC micropayments, zero API keys, built-in discovery, rate limiting, structured logging, metrics, and a revenue ledger.

```
                         ┌──────────────────────────────────────────┐
   AI Agent (MCP) ──SSE──▶                                          │
                         │        AgentForge Intelligence Suite     │
   App / cURL ────REST───▶   (single process, shared payment core)  │
                         │                                          │
                         └───────────────────┬──────────────────────┘
                                             │ x402 verify + settle
                                             ▼
                                   ┌────────────────────┐
                                   │  x402 Facilitator   │  ──▶  USDC on-chain
                                   └────────────────────┘
```

## What's in the bundle

| Service                  | MCP tool / HTTP route                                  | Category  | Price (USDC) |
| ------------------------ | ------------------------------------------------------ | --------- | ------------ |
| Sentiment Analysis       | `sentiment_analysis` · `POST /v1/sentiment`            | NLP       | $0.005       |
| Text Summarization       | `text_summarization` · `POST /v1/summarize`            | NLP       | $0.01        |
| Entity & Data Extraction | `entity_extraction` · `POST /v1/entities`              | NLP       | $0.008       |
| Language Detection       | `language_detection` · `POST /v1/language`             | NLP       | $0.004       |
| Readability Scoring      | `readability_score` · `POST /v1/readability`           | Content   | $0.006       |
| Research Brief Synthesis | `research_brief` · `POST /v1/research-brief`           | Research  | $0.03        |
| Market Intelligence      | `market_intelligence` · `POST /v1/market-intelligence` | Markets   | $0.05        |
| Automated Code Review    | `code_review` · `POST /v1/code-review`                 | Dev Tools | $0.02        |

Plus **free** utility surfaces: `ping` and `list_services` MCP tools, and `GET /`, `/catalog`, `/.well-known/x402`, `/health`, `/metrics`, `/receipts` HTTP endpoints.

> The service implementations are self-contained heuristics so the suite runs with **no external API keys**. Each module documents the single function to swap (e.g. `buildSnapshot`, `gatherContext`) to wire in a real data provider or LLM for production.

## Architecture

The defining idea: **one catalog, two transports.** Every service is declared once as a [`ServiceDefinition`](./src/services/types.ts) — pricing, validation schema, discovery metadata, and handler — and both transports are generated from that single registry, so MCP and REST never drift apart.

```
index.ts                       → entry point
src/
  config.ts                    → env validation (zod), fail-fast
  logger.ts                    → structured, level-filtered logging
  rateLimiter.ts               → per-payer / per-IP fixed-window limiter
  metrics.ts                   → usage counters + settlement receipt ledger
  payments.ts                  → shared x402 resource server + per-service requirements
  catalog.ts                   → machine-readable product catalog (discovery)
  dispatch.ts                  → transport-agnostic execution + error envelope
  server.ts                    → bootstrap: both transports + graceful shutdown
  services/                    → the 8 intelligence services (+ registry)
  mcp/server.ts                → MCP server (paid tools, hooks, Bazaar discovery)
  http/server.ts               → Express REST API (x402 middleware, Bazaar discovery)
```

Key production features:

- **Shared payment core** — a single `x402ResourceServer` is initialized once and reused by both transports, so facilitator state and the on-chain settlement path are consistent.
- **Bazaar discovery** on every paid surface (MCP `transport: "sse"` tool descriptors and HTTP body descriptors), so facilitators and marketplaces like Agentic.market can crawl and index the suite automatically.
- **Never charge for failures** — validation errors and rate-limited requests return `isError` / HTTP `4xx` _before_ settlement, so callers are not billed for failed calls.
- **Per-payer rate limiting** (MCP, by wallet) and **per-IP rate limiting** (HTTP), enforced after payment verification but before settlement.
- **Revenue ledger & metrics** — `/metrics` and `/receipts` expose live invocation counts, settled revenue, and recent settlement transactions.
- **Graceful shutdown** on `SIGINT`/`SIGTERM`.

## Setup

```bash
# from this directory
cp .env-local .env
# edit .env: set EVM_ADDRESS (your receiving wallet) and FACILITATOR_URL
pnpm install
pnpm dev
```

### Environment variables

| Variable                                  | Required | Default                        | Description                                                             |
| ----------------------------------------- | -------- | ------------------------------ | ----------------------------------------------------------------------- |
| `EVM_ADDRESS`                             | ✅       | —                              | Wallet address that receives USDC payments                              |
| `FACILITATOR_URL`                         | ✅       | `https://x402.org/facilitator` | x402 facilitator for verify/settle                                      |
| `NETWORK`                                 |          | `eip155:84532`                 | CAIP-2 network (Base Sepolia by default; use `eip155:8453` for mainnet) |
| `MCP_PORT`                                |          | `4022`                         | Port for the MCP (SSE) transport                                        |
| `HTTP_PORT`                               |          | `4021`                         | Port for the REST API                                                   |
| `MCP_PUBLIC_URL` / `HTTP_PUBLIC_URL`      |          | localhost                      | Public origins advertised in the catalog                                |
| `LOG_LEVEL`                               |          | `info`                         | `debug` \| `info` \| `warn` \| `error`                                  |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` |          | `120` / `60000`                | Rate limit per payer/IP per window                                      |
| `PRICE_MULTIPLIER`                        |          | `1.0`                          | Global multiplier applied to every base price                           |

## Using the suite

### As an MCP server (AI agents)

Connect any x402-aware MCP client to the SSE endpoint:

```
http://localhost:4022/sse
```

Call `list_services` (free) to discover everything, then call any paid tool — the client pays automatically via x402. See [`examples/typescript/clients/mcp`](../../clients/mcp) for a ready-made client.

```ts
const result = await x402Mcp.callTool("market_intelligence", { ticker: "AAPL" });
```

### As a REST API

```bash
# Discover the catalog (free)
curl http://localhost:4021/catalog

# Call a paid service — first request returns HTTP 402 with payment
# requirements in the PAYMENT-REQUIRED header; pay and retry via any x402 client.
curl -X POST http://localhost:4021/v1/sentiment \
  -H 'Content-Type: application/json' \
  -d '{"text":"I absolutely love this, it works great!"}'
```

Use [`@x402/fetch`](../../../typescript/packages/http/fetch) or any x402 client to handle the 402 → pay → retry flow automatically.

### The payment flow (per call)

1. Client calls a paid tool / endpoint.
2. Server responds with a `402` challenge containing x402 `PaymentRequired` (and Bazaar discovery metadata).
3. Client signs a USDC payment authorization and retries.
4. Server verifies via the facilitator, runs the service, then **settles on-chain**.
5. The settlement receipt is returned (MCP `_meta` / HTTP headers) and recorded in `/receipts`.

## Listing on Agentic.market

The suite is built to be marketplace-ready:

- **`GET /.well-known/x402`** and **`GET /catalog`** return a machine-readable product manifest (services, pricing, schemas, examples, transports).
- Every paid resource embeds a **Bazaar discovery extension** in its `402` response, so facilitators that index discoverable resources will catalog each tool/endpoint with its input/output schema and an example.
- Pricing, network, and currency (USDC) are advertised per service.

To list:

1. Deploy with `NETWORK=eip155:8453` (Base mainnet) and your production `EVM_ADDRESS`.
2. Set `MCP_PUBLIC_URL` / `HTTP_PUBLIC_URL` to your deployed origins.
3. Submit your MCP SSE URL (and/or REST base URL) to Agentic.market; it will read the catalog and discovery metadata to populate the listing.

## Observability

```bash
curl http://localhost:4021/health     # liveness + uptime
curl http://localhost:4021/metrics    # invocations, paid calls, settled revenue per service
curl http://localhost:4021/receipts   # recent settlement transactions
```

## Extending the suite

Add a new service in three steps:

1. Create `src/services/myService.ts` exporting a `ServiceDefinition` (schema, price, discovery metadata, handler).
2. Add it to the `SERVICES` array in [`src/services/index.ts`](./src/services/index.ts).
3. Done — it is automatically exposed as a paid MCP tool **and** a REST endpoint, added to the catalog, and made discoverable.

## Scripts

| Script                              | Description                     |
| ----------------------------------- | ------------------------------- |
| `pnpm dev` / `pnpm start`           | Run the suite (both transports) |
| `pnpm typecheck`                    | `tsc --noEmit`                  |
| `pnpm lint:check` / `pnpm lint`     | ESLint (check / fix)            |
| `pnpm format:check` / `pnpm format` | Prettier (check / write)        |

## Disclaimer

The intelligence services use deterministic, self-contained heuristics for demonstration and are **not** a substitute for production models or licensed data feeds (in particular, `market_intelligence` output is synthetic and is **not** investment advice). Replace the documented seam in each service to integrate real providers.
