/**
 * Centralized, validated configuration for the AgentForge Intelligence Suite.
 *
 * All environment access funnels through this module so the rest of the codebase
 * works with a single, strongly-typed config object. Invalid configuration fails
 * fast at boot with an actionable error message instead of surfacing as a cryptic
 * runtime failure deep inside a request handler.
 */

import type { Network } from "@x402/core/types";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

/**
 * Zod schema describing every supported environment variable.
 *
 * Defaults mirror the values documented in `.env-local` so the suite can boot on
 * a developer machine with only `EVM_ADDRESS` and `FACILITATOR_URL` provided.
 */
const envSchema = z.object({
  EVM_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "EVM_ADDRESS must be a 0x-prefixed 40-character hex address"),
  FACILITATOR_URL: z.string().url("FACILITATOR_URL must be a valid URL"),
  NETWORK: z.string().default("eip155:84532"),
  // Railway and most PaaS providers inject a single PORT. When present, both
  // transports are served from it; otherwise the dedicated ports below are used.
  PORT: z.coerce.number().int().positive().optional(),
  MCP_PORT: z.coerce.number().int().positive().default(4022),
  HTTP_PORT: z.coerce.number().int().positive().default(4021),
  MCP_PUBLIC_URL: z.string().url().default("http://localhost:4022"),
  HTTP_PUBLIC_URL: z.string().url().default("http://localhost:4021"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  PRICE_MULTIPLIER: z.coerce.number().positive().default(1),

  // ----- Real intelligence providers (optional; enable production-grade output) -----
  // OpenAI-compatible Chat Completions endpoint powering the NLP / research /
  // code-review services. Works with OpenAI, Azure OpenAI, OpenRouter, Together,
  // Groq, or a self-hosted gateway. When unset, services fall back to their
  // built-in deterministic algorithms.
  LLM_API_KEY: z.string().min(1).optional(),
  LLM_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  LLM_MODEL: z.string().min(1).default("gpt-4o-mini"),

  // Market-data providers for the market_intelligence service.
  // CoinGecko (crypto) works key-free; a key raises rate limits. Alpha Vantage
  // (equities) requires a free key from https://www.alphavantage.co/support/#api-key
  COINGECKO_API_KEY: z.string().min(1).optional(),
  ALPHAVANTAGE_API_KEY: z.string().min(1).optional(),

  // Upstream provider request timeout (ms).
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
});

/**
 * Fully-typed, validated configuration object.
 */
export type AppConfig = {
  evmAddress: `0x${string}`;
  facilitatorUrl: string;
  network: Network;
  singlePort?: number;
  mcpPort: number;
  httpPort: number;
  mcpPublicUrl: string;
  httpPublicUrl: string;
  logLevel: "debug" | "info" | "warn" | "error";
  rateLimitMax: number;
  rateLimitWindowMs: number;
  priceMultiplier: number;
  llm: { apiKey?: string; baseUrl: string; model: string };
  marketData: { coingeckoApiKey?: string; alphaVantageApiKey?: string };
  providerTimeoutMs: number;
};

/**
 * Parse and validate the process environment into a typed {@link AppConfig}.
 *
 * @returns The validated application configuration.
 * @throws If any required variable is missing or malformed, exits the process.
 */
export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(issue => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    console.error(
      `\n❌ AgentForge configuration is invalid. Fix the following environment variables:\n${issues}\n\n` +
        `Tip: copy .env-local to .env and fill in the required values.\n`,
    );
    process.exit(1);
  }

  const env = parsed.data;

  return {
    evmAddress: env.EVM_ADDRESS as `0x${string}`,
    facilitatorUrl: env.FACILITATOR_URL,
    network: env.NETWORK as Network,
    singlePort: env.PORT,
    mcpPort: env.MCP_PORT,
    httpPort: env.HTTP_PORT,
    mcpPublicUrl: env.MCP_PUBLIC_URL,
    httpPublicUrl: env.HTTP_PUBLIC_URL,
    logLevel: env.LOG_LEVEL,
    rateLimitMax: env.RATE_LIMIT_MAX,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    priceMultiplier: env.PRICE_MULTIPLIER,
    llm: { apiKey: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL, model: env.LLM_MODEL },
    marketData: {
      coingeckoApiKey: env.COINGECKO_API_KEY,
      alphaVantageApiKey: env.ALPHAVANTAGE_API_KEY,
    },
    providerTimeoutMs: env.PROVIDER_TIMEOUT_MS,
  };
}
