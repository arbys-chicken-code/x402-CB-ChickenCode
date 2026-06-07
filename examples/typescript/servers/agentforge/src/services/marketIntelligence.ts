/**
 * Market intelligence service.
 *
 * Fetches **live** market data and computes a technical + fundamental snapshot
 * with a composite trading signal. Crypto is sourced from CoinGecko (key-free);
 * equities from Alpha Vantage (requires `ALPHAVANTAGE_API_KEY`). All indicators
 * (RSI-14, SMA-50/200, volatility) are derived from real historical closes.
 */

import { z } from "zod";

import { getMarketData, type MarketSnapshot } from "../providers";
import type { ServiceDefinition, ServiceResult } from "./types";
import { clamp, round } from "./util";

const schema = z.object({
  ticker: z
    .string()
    .min(1, "ticker is required")
    .max(12, "ticker must be 12 characters or fewer")
    .regex(/^[A-Za-z.\-:]{1,12}$/, "ticker must be alphanumeric (e.g. AAPL, BTC-USD)")
    .describe("The asset ticker symbol, e.g. AAPL or BTC-USD"),
  horizon: z
    .enum(["intraday", "swing", "long_term"])
    .optional()
    .describe("Analysis horizon (default swing)"),
});

/**
 * Compute a composite buy/sell signal from real indicators.
 *
 * Indicators that are unavailable (null) simply do not contribute, so the
 * signal degrades gracefully for assets with limited history.
 *
 * @param snapshot - The live market snapshot.
 * @returns The signal action, normalized score, and confidence.
 */
function computeSignal(snapshot: MarketSnapshot): {
  action: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  compositeScore: number;
  confidence: number;
} {
  const { quote, technical } = snapshot;
  let score = 0;
  let signals = 0;

  if (technical.rsi14 != null) {
    score += technical.rsi14 < 30 ? 1.2 : technical.rsi14 > 70 ? -1.2 : 0;
    signals += 1;
  }
  if (technical.sma50 != null && quote.price) {
    score += quote.price > technical.sma50 ? 0.8 : -0.8;
    signals += 1;
  }
  if (technical.sma50 != null && technical.sma200 != null) {
    score += technical.sma50 > technical.sma200 ? 1 : -1; // golden vs death cross
    signals += 1;
  }
  if (quote.changePercent != null) {
    score += quote.changePercent > 0 ? 0.5 : -0.5;
    signals += 1;
  }
  if (technical.annualizedVolatility != null && technical.annualizedVolatility > 0.8) {
    score -= 0.6;
  }

  const normalized = signals === 0 ? 0 : round(clamp(Math.tanh(score / 2), -1, 1), 4);
  let action: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  if (normalized > 0.5) action = "strong_buy";
  else if (normalized > 0.15) action = "buy";
  else if (normalized < -0.5) action = "strong_sell";
  else if (normalized < -0.15) action = "sell";
  else action = "hold";

  return {
    action,
    compositeScore: normalized,
    confidence: round(clamp(0.4 + (Math.abs(normalized) / 2) * (signals / 4), 0, 1), 4),
  };
}

/**
 * Generate a market intelligence report from live data.
 *
 * @param args - Raw arguments validated against the service schema.
 * @returns A {@link ServiceResult} containing the live market snapshot + signal.
 */
async function handler(args: Record<string, unknown>): Promise<ServiceResult> {
  const { ticker, horizon } = schema.parse(args);
  const snapshot = await getMarketData().getSnapshot(ticker);
  const signal = computeSignal(snapshot);

  return {
    summary: `${snapshot.ticker} (${snapshot.assetClass}): ${signal.action.replace("_", " ")} — source ${snapshot.source}.`,
    data: {
      ...snapshot,
      horizon: horizon ?? "swing",
      signal,
      disclaimer: "Informational market analytics derived from live data. Not financial advice.",
    },
  };
}

/**
 * Market intelligence service definition.
 */
export const marketIntelligenceService: ServiceDefinition = {
  name: "market_intelligence",
  title: "Market Intelligence",
  category: "markets",
  description:
    "Live technical + fundamental snapshot for any ticker (crypto via CoinGecko, equities via " +
    "Alpha Vantage): real RSI-14, SMA-50/200 trend, annualized volatility, P/E, and a composite signal.",
  price: "$0.05",
  shape: schema.shape,
  inputSchema: {
    type: "object",
    properties: {
      ticker: { type: "string", description: "The asset ticker symbol, e.g. AAPL or BTC-USD" },
      horizon: {
        type: "string",
        enum: ["intraday", "swing", "long_term"],
        description: "Analysis horizon (default swing)",
      },
    },
    required: ["ticker"],
  },
  exampleInput: { ticker: "BTC", horizon: "swing" },
  exampleOutput: {
    ticker: "BTC",
    assetClass: "crypto",
    source: "coingecko",
    quote: { price: 67000.12, changePercent: 1.8, volume: 38450120000 },
    technical: { rsi14: 58.2, sma50: 64000, sma200: 59000, trend: "uptrend" },
    signal: { action: "buy", compositeScore: 0.41, confidence: 0.66 },
  },
  http: { method: "POST", path: "/v1/market-intelligence" },
  handler,
};
