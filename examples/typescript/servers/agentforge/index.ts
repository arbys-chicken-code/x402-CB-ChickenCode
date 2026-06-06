/**
 * AgentForge Intelligence Suite — entry point.
 *
 * A production-ready, multi-service paid product built on the x402 payment
 * protocol. It exposes a bundle of intelligence services to AI agents over two
 * transports simultaneously:
 *
 *   - MCP (Model Context Protocol) over SSE — for agent frameworks.
 *   - A REST/HTTP API — for everything else.
 *
 * Every paid call is settled in USDC via x402, with no API keys. See README.md
 * for the full architecture and Agentic.market listing details.
 *
 * Run with: pnpm dev
 */

import { startServer } from "./src/server";

startServer().catch(error => {
  console.error("❌ Fatal error during startup:", error);
  process.exit(1);
});
