/**
 * Application bootstrap for the AgentForge Intelligence Suite.
 *
 * Wires configuration, logging, the x402 payment layer, metrics, and rate
 * limiting into the two transports (MCP over SSE and a REST API), each on its
 * own port, and installs graceful-shutdown handlers.
 */

import type { Server } from "node:http";

import express from "express";

import { loadConfig } from "./config";
import { mountHttp } from "./http/server";
import { createLogger } from "./logger";
import { mountMcp } from "./mcp/server";
import { Metrics } from "./metrics";
import { createPaymentLayer } from "./payments";
import { RateLimiter } from "./rateLimiter";
import { SERVICES } from "./services";

/**
 * Print a human-friendly startup banner summarizing the running suite.
 *
 * @param mcpPort - Port the MCP/SSE transport listens on.
 * @param httpPort - Port the REST API listens on.
 */
function printBanner(mcpPort: number, httpPort: number): void {
  const lines = [
    "",
    "  ╔══════════════════════════════════════════════════════════════╗",
    "  ║          AgentForge Intelligence Suite — online                ║",
    "  ╚══════════════════════════════════════════════════════════════╝",
    "",
    `  💼 ${SERVICES.length} paid intelligence services (x402 / USDC)`,
    `  🧠 MCP (SSE):   http://localhost:${mcpPort}/sse`,
    `  🌐 REST API:    http://localhost:${httpPort}`,
    `  📒 Catalog:     http://localhost:${httpPort}/catalog`,
    `  🩺 Health:      http://localhost:${httpPort}/health`,
    `  📈 Metrics:     http://localhost:${httpPort}/metrics`,
    "",
  ];
  console.log(lines.join("\n"));
}

/**
 * Start the full AgentForge suite.
 *
 * @returns A promise that resolves once both transports are listening.
 */
export async function startServer(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  logger.info("Booting AgentForge Intelligence Suite", {
    network: config.network,
    services: SERVICES.length,
  });

  const payments = await createPaymentLayer(config, logger);
  const metrics = new Metrics();
  const rateLimiter = new RateLimiter(config.rateLimitMax, config.rateLimitWindowMs);

  const deps = { config, payments, metrics, rateLimiter };

  const mcpApp = express();
  mountMcp(mcpApp, { ...deps, logger: logger.child("mcp") });

  const httpApp = express();
  mountHttp(httpApp, { ...deps, logger: logger.child("http") });

  const servers: Server[] = [];

  await new Promise<void>(resolve => {
    servers.push(mcpApp.listen(config.mcpPort, () => resolve()));
  });
  await new Promise<void>(resolve => {
    servers.push(httpApp.listen(config.httpPort, () => resolve()));
  });

  printBanner(config.mcpPort, config.httpPort);

  let shuttingDown = false;
  /**
   * Gracefully drain connections and stop background timers.
   *
   * @param signal - The OS signal that triggered shutdown.
   */
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down", { signal });
    rateLimiter.stop();
    let remaining = servers.length;
    for (const server of servers) {
      server.close(() => {
        remaining -= 1;
        if (remaining === 0) {
          logger.info("Shutdown complete");
          process.exit(0);
        }
      });
    }
    // Failsafe: force exit if connections do not drain promptly.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
