/**
 * Market intelligence service.
 *
 * Produces a deterministic-but-plausible technical and fundamental snapshot for
 * a ticker symbol, including momentum indicators and a composite signal. Output
 * is seeded by the ticker so it is reproducible. This is a synthetic analytics
 * engine for demonstration — wire it to a real market-data provider in
 * production by replacing {@link buildSnapshot}.
 */

import { z } from "zod";

import type { ServiceDefinition, ServiceResult } from "./types";
import { clamp, hashString, round, seededRng } from "./util";

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
 * Build a synthetic but deterministic market snapshot for a ticker.
 *
 * @param ticker - Normalized ticker symbol.
 * @param horizon - Analysis horizon.
 * @returns Structured indicators, fundamentals, and a composite signal.
 */
function buildSnapshot(
  ticker: string,
  horizon: "intraday" | "swing" | "long_term",
): Record<string, unknown> {
  const rng = seededRng(hashString(`${ticker}:${horizon}`));

  const price = round(5 + rng() * 800, 2);
  const changePct = round((rng() - 0.5) * (horizon === "intraday" ? 6 : 14), 2);
  const rsi = round(20 + rng() * 60, 1);
  const sma50 = round(price * (0.85 + rng() * 0.3), 2);
  const sma200 = round(price * (0.7 + rng() * 0.5), 2);
  const volatility = round(0.1 + rng() * 0.6, 3);
  const peRatio = round(8 + rng() * 45, 1);
  const volume = Math.floor(1e5 + rng() * 5e7);

  // Composite score blends momentum, trend, and mean-reversion cues.
  let score = 0;
  score += rsi < 30 ? 1.2 : rsi > 70 ? -1.2 : 0;
  score += price > sma50 ? 0.8 : -0.8;
  score += sma50 > sma200 ? 1 : -1; // golden vs death cross
  score += changePct > 0 ? 0.5 : -0.5;
  score -= volatility > 0.5 ? 0.6 : 0;

  const normalized = round(clamp(Math.tanh(score / 2), -1, 1), 4);
  let signal: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  if (normalized > 0.5) signal = "strong_buy";
  else if (normalized > 0.15) signal = "buy";
  else if (normalized < -0.5) signal = "strong_sell";
  else if (normalized < -0.15) signal = "sell";
  else signal = "hold";

  return {
    ticker,
    horizon,
    quote: { price, changePercent: changePct, volume },
    technical: {
      rsi14: rsi,
      sma50,
      sma200,
      trend: sma50 > sma200 ? "uptrend" : "downtrend",
      annualizedVolatility: volatility,
    },
    fundamental: {
      peRatio,
      valuation: peRatio > 35 ? "rich" : peRatio < 15 ? "cheap" : "fair",
    },
    signal: {
      action: signal,
      compositeScore: normalized,
      confidence: round(0.5 + Math.abs(normalized) / 2, 4),
    },
    disclaimer:
      "Synthetic analytics for demonstration. Not investment advice. Replace buildSnapshot() " +
      "with a licensed market-data feed for production use.",
  };
}

/**
 * Generate a market intelligence report for a ticker.
 *
 * @param args - Raw arguments validated against the service schema.
 * @returns A {@link ServiceResult} containing the market snapshot.
 */
function handler(args: Record<string, unknown>): ServiceResult {
  const { ticker, horizon } = schema.parse(args);
  const normalizedTicker = ticker.toUpperCase();
  const snapshot = buildSnapshot(normalizedTicker, horizon ?? "swing");
  const signal = (snapshot.signal as { action: string }).action;

  return {
    summary: `${normalizedTicker}: ${signal.replace("_", " ")} signal.`,
    data: snapshot,
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
    "Generate a technical + fundamental snapshot for any ticker (equities or crypto), including " +
    "RSI, moving-average trend, volatility, valuation, and a composite buy/sell signal.",
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
  exampleInput: { ticker: "AAPL", horizon: "swing" },
  exampleOutput: {
    ticker: "AAPL",
    quote: { price: 212.4, changePercent: 1.8, volume: 38450120 },
    technical: { rsi14: 58.2, trend: "uptrend" },
    signal: { action: "buy", compositeScore: 0.41, confidence: 0.71 },
  },
  http: { method: "POST", path: "/v1/market-intelligence" },
  handler,
};
