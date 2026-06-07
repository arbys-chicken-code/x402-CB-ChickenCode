/**
 * Public catalog generation.
 *
 * Produces the machine-readable product catalog advertised to AI agents and to
 * Agentic.market. The catalog is derived from the service registry plus the
 * resolved (multiplier-adjusted) prices, so it always reflects what the server
 * will actually charge.
 */

import type { AppConfig } from "./config";
import type { PaymentLayer } from "./payments";
import { getLlm } from "./providers";
import { SERVICES } from "./services";

/**
 * Build the full product catalog object.
 *
 * @param config - Validated application configuration.
 * @param payments - Initialized payment layer (for effective prices).
 * @returns A JSON-serializable catalog describing the product and its services.
 */
export function buildCatalog(config: AppConfig, payments: PaymentLayer): Record<string, unknown> {
  const services = SERVICES.map(service => ({
    name: service.name,
    title: service.title,
    category: service.category,
    description: service.description,
    price: payments.effectivePrice.get(service.name) ?? service.price,
    currency: "USDC",
    network: config.network,
    access: {
      mcpTool: service.name,
      httpEndpoint: `${service.http.method} ${service.http.path}`,
    },
    inputSchema: service.inputSchema,
    exampleInput: service.exampleInput,
    exampleOutput: service.exampleOutput,
  }));

  return {
    product: {
      id: "agentforge-intelligence-suite",
      name: "AgentForge Intelligence Suite",
      version: "1.0.0",
      tagline:
        "A production-ready bundle of pay-per-call intelligence services for autonomous AI agents.",
      description:
        "AgentForge bundles eight high-value intelligence services — NLP, market analytics, " +
        "research synthesis, and developer tooling — behind the x402 payment protocol. Every " +
        "service is callable both as an MCP tool (for agent frameworks) and as a REST endpoint, " +
        "with per-call USDC micropayments and zero API keys.",
      categories: [...new Set(SERVICES.map(s => s.category))],
      paymentProtocol: "x402",
      currency: "USDC",
      network: config.network,
    },
    transports: {
      mcp: {
        url: `${config.mcpPublicUrl}/sse`,
        protocol: "sse",
        description: "Model Context Protocol endpoint for AI agent frameworks.",
      },
      http: {
        baseUrl: config.httpPublicUrl,
        protocol: "rest",
        description: "REST API. Send payment via the x402 flow (HTTP 402 challenge).",
      },
    },
    capabilities: {
      llm: {
        enabled: getLlm().isConfigured(),
        model: getLlm().isConfigured() ? getLlm().modelName() : null,
        poweredServices: [
          "sentiment_analysis",
          "text_summarization",
          "entity_extraction",
          "language_detection",
          "research_brief",
          "code_review",
        ],
      },
      marketData: {
        crypto: { provider: "coingecko", requiresKey: false },
        equities: {
          provider: "alphavantage",
          requiresKey: true,
          configured: Boolean(config.marketData.alphaVantageApiKey),
        },
      },
    },
    serviceCount: services.length,
    services,
    links: {
      catalog: `${config.httpPublicUrl}/catalog`,
      wellKnown: `${config.httpPublicUrl}/.well-known/x402`,
      health: `${config.httpPublicUrl}/health`,
      metrics: `${config.httpPublicUrl}/metrics`,
    },
  };
}
