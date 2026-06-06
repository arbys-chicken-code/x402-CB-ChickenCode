/**
 * MCP transport for the AgentForge Intelligence Suite.
 *
 * Builds a single {@link McpServer} exposing every catalog service as a paid
 * tool (via `createPaymentWrapper`) plus a couple of free utility tools. Each
 * paid tool advertises Bazaar discovery metadata and enforces per-payer rate
 * limiting and settlement accounting through wrapper hooks.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createPaymentWrapper } from "@x402/mcp";
import express, { type Express } from "express";

import { buildCatalog } from "../catalog";
import type { AppConfig } from "../config";
import { extractPayer, runService, type ServiceEnvelope } from "../dispatch";
import type { Logger } from "../logger";
import type { Metrics } from "../metrics";
import type { PaymentLayer } from "../payments";
import type { RateLimiter } from "../rateLimiter";
import { SERVICES, type ServiceDefinition } from "../services";

/**
 * Shared dependencies required to build the MCP server.
 */
export interface McpDeps {
  config: AppConfig;
  payments: PaymentLayer;
  metrics: Metrics;
  rateLimiter: RateLimiter;
  logger: Logger;
}

/**
 * Convert a service envelope into an MCP tool result.
 *
 * Validation/internal errors are flagged with `isError: true` so the x402
 * payment wrapper skips settlement — callers are never charged for failed calls.
 *
 * @param envelope - The normalized service envelope.
 * @returns An MCP tool result object.
 */
function toToolResult(envelope: ServiceEnvelope): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    isError: envelope.ok ? undefined : true,
  };
}

/**
 * Register a single paid service as an MCP tool with payment + hooks.
 *
 * @param mcpServer - The MCP server to register the tool on.
 * @param service - The service definition to expose.
 * @param deps - Shared MCP dependencies.
 */
function registerPaidTool(mcpServer: McpServer, service: ServiceDefinition, deps: McpDeps): void {
  const { payments, metrics, rateLimiter, logger, config } = deps;
  const accepts = payments.requirements.get(service.name);
  if (!accepts) {
    throw new Error(`Missing payment requirements for service ${service.name}`);
  }

  const discovery = declareDiscoveryExtension({
    toolName: service.name,
    description: service.description,
    transport: "sse",
    inputSchema: service.inputSchema,
    example: service.exampleInput,
    output: { example: service.exampleOutput },
  });

  const paid = createPaymentWrapper(payments.resourceServer, {
    accepts,
    resource: {
      url: `mcp://tool/${service.name}`,
      description: service.title,
      mimeType: "application/json",
    },
    extensions: discovery,
    hooks: {
      onBeforeExecution: async context => {
        const payer = extractPayer(context.paymentPayload);
        const decision = rateLimiter.check(`${service.name}:${payer}`);
        if (!decision.allowed) {
          metrics.recordRateLimited(service.name);
          logger.warn("Rate limit exceeded", { service: service.name, payer });
          return false;
        }
        return true;
      },
      onAfterSettlement: async context => {
        const settlement = context.settlement as {
          transaction?: string;
          network?: string;
          success?: boolean;
        };
        const accepted = accepts[0];
        metrics.recordSettlement({
          service: service.name,
          transport: "mcp",
          payer: extractPayer(context.paymentPayload),
          amount: accepted.amount,
          asset: accepted.asset ?? "USDC",
          network: settlement.network ?? config.network,
          transaction: settlement.transaction ?? "",
          timestampMs: Date.now(),
        });
        logger.info("Settled MCP payment", {
          service: service.name,
          transaction: settlement.transaction,
        });
      },
    },
  });

  const priceLabel = payments.effectivePrice.get(service.name) ?? service.price;

  mcpServer.tool(
    service.name,
    `${service.description} (paid: ${priceLabel} USDC)`,
    service.shape,
    paid(async (args: Record<string, unknown>) => {
      const envelope = await runService(service, args, metrics, logger);
      return toToolResult(envelope);
    }),
  );

  logger.debug("Registered paid MCP tool", { service: service.name, price: priceLabel });
}

/**
 * Build the AgentForge MCP server with all paid and free tools registered.
 *
 * @param deps - Shared MCP dependencies.
 * @returns The configured {@link McpServer} instance.
 */
export function buildMcpServer(deps: McpDeps): McpServer {
  const { logger } = deps;
  const mcpServer = new McpServer({
    name: "AgentForge Intelligence Suite",
    version: "1.0.0",
  });

  for (const service of SERVICES) {
    registerPaidTool(mcpServer, service, deps);
  }

  // Free utility tool: liveness check.
  mcpServer.tool("ping", "Free health check. Returns 'pong'.", {}, async () => ({
    content: [{ type: "text", text: "pong" }],
  }));

  // Free utility tool: machine-readable catalog of every paid service.
  mcpServer.tool(
    "list_services",
    "Free. List every AgentForge service with pricing, schemas, and examples.",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(buildCatalog(deps.config, deps.payments), null, 2),
        },
      ],
    }),
  );

  logger.info("MCP server built", { paidTools: SERVICES.length, freeTools: 2 });
  return mcpServer;
}

/**
 * Mount the MCP server on an Express app using the SSE transport.
 *
 * Supports multiple concurrent agent sessions, each with its own transport and
 * a fresh server connection.
 *
 * @param app - The Express application to attach MCP routes to.
 * @param deps - Shared MCP dependencies.
 */
export function mountMcp(app: Express, deps: McpDeps): void {
  const { logger } = deps;
  const transports = new Map<string, SSEServerTransport>();

  app.get("/sse", async (_req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    transports.set(transport.sessionId, transport);
    logger.debug("MCP SSE connection opened", { sessionId: transport.sessionId });

    res.on("close", () => {
      transports.delete(transport.sessionId);
      logger.debug("MCP SSE connection closed", { sessionId: transport.sessionId });
    });

    // Each connection gets its own server instance so tool state is isolated.
    const server = buildMcpServer(deps);
    await server.connect(transport);
  });

  app.post("/messages", express.json(), async (req, res) => {
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
    const transport = sessionId ? transports.get(sessionId) : Array.from(transports.values())[0];

    if (!transport) {
      res.status(400).json({ error: "No active MCP SSE session" });
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  });
}
