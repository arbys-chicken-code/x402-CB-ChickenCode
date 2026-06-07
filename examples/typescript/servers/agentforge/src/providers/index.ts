/**
 * Provider registry.
 *
 * Real upstream providers (LLM, market data) are constructed once at boot and
 * accessed by services through these getters. Keeping them behind an explicit
 * init keeps service modules free of environment access while still allowing
 * them to use real integrations.
 */

import type { AppConfig } from "../config";
import { LlmProvider } from "./llm";
import { MarketDataProvider } from "./marketData";

let llmProvider: LlmProvider | undefined;
let marketDataProvider: MarketDataProvider | undefined;

/**
 * Initialize all providers from configuration. Call once during boot.
 *
 * @param config - Validated application configuration.
 */
export function initProviders(config: AppConfig): void {
  llmProvider = new LlmProvider(config);
  marketDataProvider = new MarketDataProvider(config);
}

/**
 * Get the LLM provider.
 *
 * @returns The initialized {@link LlmProvider}.
 * @throws If called before {@link initProviders}.
 */
export function getLlm(): LlmProvider {
  if (!llmProvider) throw new Error("Providers not initialized; call initProviders() first");
  return llmProvider;
}

/**
 * Get the market-data provider.
 *
 * @returns The initialized {@link MarketDataProvider}.
 * @throws If called before {@link initProviders}.
 */
export function getMarketData(): MarketDataProvider {
  if (!marketDataProvider) {
    throw new Error("Providers not initialized; call initProviders() first");
  }
  return marketDataProvider;
}

export { LlmProvider } from "./llm";
export { MarketDataProvider, type MarketSnapshot } from "./marketData";
export { ProviderError } from "./http";
