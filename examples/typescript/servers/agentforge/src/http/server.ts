/**
 * HTTP/REST transport for the AgentForge Intelligence Suite.
 *
 * Exposes every catalog service as a payment-protected POST endpoint using the
 * `@x402/express` middleware, alongside free discovery/observability endpoints
 * (`/catalog`, `/.well-known/x402`, `/health`, `/metrics`, `/receipts`).
 */

import { paymentMiddleware } from "@x402/express";
import type { RoutesConfig } from "@x402/core/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import express, { type Express, type NextFunction, type Request, type Response } from "express";

import { buildCatalog } from "../catalog";
import type { AppConfig } from "../config";
import { extractPayer, runService } from "../dispatch";
import type { Logger } from "../logger";
import type { Metrics } from "../metrics";
import type { PaymentLayer } from "../payments";
import type { RateLimiter } from "../rateLimiter";
import { SERVICES, type ServiceDefinition } from "../services";

/**
 * Shared dependencies required to build the HTTP server.
 */
export interface HttpDeps {
  config: AppConfig;
  payments: PaymentLayer;
  metrics: Metrics;
  rateLimiter: RateLimiter;
  logger: Logger;
}

/**
 * Build the x402 route configuration (one protected route per service).
 *
 * @param deps - Shared HTTP dependencies.
 * @returns A {@link RoutesConfig} consumed by the payment middleware.
 */
function buildRoutes(deps: HttpDeps): RoutesConfig {
  const { config, payments } = deps;
  const routes: RoutesConfig = {};

  for (const service of SERVICES) {
    const price = payments.effectivePrice.get(service.name) ?? service.price;
    routes[`${service.http.method} ${service.http.path}`] = {
      accepts: {
        scheme: "exact",
        price,
        network: config.network,
        payTo: config.evmAddress,
      },
      description: `${service.title} — ${service.description}`,
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        input: service.exampleInput,
        inputSchema: service.inputSchema,
        bodyType: "json",
        output: { example: service.exampleOutput },
      }),
    };
  }

  return routes;
}

/**
 * Build a per-service rate-limiting middleware.
 *
 * Runs only for payment-verified requests (it is mounted after the payment
 * middleware), so rejecting with HTTP 429 also prevents settlement — the caller
 * is not charged when throttled. Keyed by client IP since the payer address is
 * already constrained by the verified payment.
 *
 * @param service - The service the limiter guards.
 * @param deps - Shared HTTP dependencies.
 * @returns An Express middleware enforcing the rate limit.
 */
function rateLimitMiddleware(service: ServiceDefinition, deps: HttpDeps) {
  const { rateLimiter, metrics, logger } = deps;
  return (req: Request, res: Response, next: NextFunction): void => {
    const client = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const decision = rateLimiter.check(`http:${service.name}:${client}`);
    res.setHeader("X-RateLimit-Limit", String(decision.limit));
    res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(decision.resetAt / 1000)));

    if (!decision.allowed) {
      metrics.recordRateLimited(service.name);
      logger.warn("HTTP rate limit exceeded", { service: service.name, client });
      res.status(429).json({
        ok: false,
        service: service.name,
        error: { type: "rate_limited", message: "Rate limit exceeded. Try again shortly." },
      });
      return;
    }
    next();
  };
}

/**
 * Build a per-service request handler.
 *
 * @param service - The service to execute.
 * @param deps - Shared HTTP dependencies.
 * @returns An Express handler that runs the service and returns its envelope.
 */
function serviceHandler(service: ServiceDefinition, deps: HttpDeps) {
  const { metrics, logger } = deps;
  return async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const envelope = await runService(service, body, metrics, logger);
    res.status(envelope.ok ? 200 : 400).json(envelope);
  };
}

/**
 * Register the global settlement hook that records HTTP receipts.
 *
 * The shared resource server also settles MCP payments, but those carry no HTTP
 * transport context, so this hook ignores them (they are recorded by the MCP
 * wrapper instead) — preventing double counting.
 *
 * @param deps - Shared HTTP dependencies.
 */
function registerHttpSettlementHook(deps: HttpDeps): void {
  const { payments, metrics, config, logger } = deps;
  const byPath = new Map(SERVICES.map(s => [s.http.path, s] as const));

  payments.resourceServer.onAfterSettle(async context => {
    const transport = context.transportContext as { request?: { path?: string } } | undefined;
    const path = transport?.request?.path;
    if (!path) return; // Not an HTTP settlement (e.g. MCP) — handled elsewhere.

    const service = byPath.get(path);
    if (!service) return;

    const result = context.result as { transaction?: string; network?: string };
    metrics.recordSettlement({
      service: service.name,
      transport: "http",
      payer: extractPayer(context.paymentPayload),
      amount: context.requirements.amount,
      asset: context.requirements.asset ?? "USDC",
      network: result.network ?? config.network,
      transaction: result.transaction ?? "",
      timestampMs: Date.now(),
    });
    logger.info("Settled HTTP payment", {
      service: service.name,
      transaction: result.transaction,
    });
  });
}

/**
 * Mount the REST API (free + paid routes) onto an Express app.
 *
 * @param app - The Express application.
 * @param deps - Shared HTTP dependencies.
 */
export function mountHttp(app: Express, deps: HttpDeps): void {
  const { config, payments, metrics, logger } = deps;

  app.use(express.json({ limit: "1mb" }));
  registerHttpSettlementHook(deps);

  // ----- Free discovery & observability endpoints -----
  app.get("/", (_req, res) => {
    const catalog = buildCatalog(config, payments) as { product: unknown; links: unknown };
    res.json({ ...(catalog.product as object), links: catalog.links });
  });

  app.get("/catalog", (_req, res) => {
    res.json(buildCatalog(config, payments));
  });

  // Convention endpoint marketplaces can crawl to auto-discover the product.
  app.get("/.well-known/x402", (_req, res) => {
    res.json(buildCatalog(config, payments));
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "agentforge-intelligence-suite", uptime: process.uptime() });
  });

  app.get("/metrics", (_req, res) => {
    res.json(metrics.snapshot());
  });

  app.get("/receipts", (_req, res) => {
    res.json({ receipts: metrics.receipts(50) });
  });

  // ----- Paid services: x402 payment middleware + per-route handlers -----
  // syncFacilitatorOnStart=false because the shared resource server is already
  // initialized by the payment layer; re-initializing would re-fetch needlessly.
  app.use(
    paymentMiddleware(buildRoutes(deps), payments.resourceServer, undefined, undefined, false),
  );

  for (const service of SERVICES) {
    app.post(service.http.path, rateLimitMiddleware(service, deps), serviceHandler(service, deps));
  }

  // ----- Fallback -----
  app.use((_req, res) => {
    res.status(404).json({
      ok: false,
      error: { type: "not_found", message: "Unknown endpoint. See GET /catalog." },
    });
  });

  logger.info("HTTP API mounted", { paidRoutes: SERVICES.length });
}
