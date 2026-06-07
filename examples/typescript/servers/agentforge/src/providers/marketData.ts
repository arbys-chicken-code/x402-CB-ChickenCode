/**
 * Real market-data provider for the market_intelligence service.
 *
 * Crypto assets are sourced from CoinGecko (works key-free; a key raises rate
 * limits). Equities are sourced from Alpha Vantage (requires a free API key).
 * Technical indicators (RSI-14, SMA-50/200, annualized volatility) are computed
 * from actual historical closing prices — no synthetic data.
 */

import type { AppConfig } from "../config";
import { fetchJson, ProviderError } from "./http";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const ALPHAVANTAGE_BASE = "https://www.alphavantage.co/query";

const COMMON_CRYPTO = new Set([
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "ADA",
  "DOGE",
  "AVAX",
  "DOT",
  "MATIC",
  "LINK",
  "LTC",
  "BCH",
  "ATOM",
  "UNI",
  "USDC",
  "USDT",
  "BNB",
  "TRX",
  "SHIB",
  "NEAR",
]);

/**
 * Normalized, real market snapshot returned to the service layer.
 */
export interface MarketSnapshot {
  ticker: string;
  assetClass: "crypto" | "equity";
  source: string;
  asOf: string;
  quote: { price: number; changePercent: number | null; volume: number | null };
  technical: {
    rsi14: number | null;
    sma50: number | null;
    sma200: number | null;
    trend: "uptrend" | "downtrend" | "unknown";
    annualizedVolatility: number | null;
  };
  fundamental: { peRatio: number | null; valuation: string | null };
}

/**
 * Round a number to a fixed number of decimal places.
 *
 * @param value - Value to round.
 * @param decimals - Decimal places.
 * @returns The rounded value.
 */
function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Simple moving average of the last `period` closes.
 *
 * @param closes - Closing prices, oldest to newest.
 * @param period - Window length.
 * @returns The SMA, or null if insufficient data.
 */
function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const window = closes.slice(closes.length - period);
  return round(window.reduce((a, b) => a + b, 0) / period, 4);
}

/**
 * Wilder's Relative Strength Index over `period` closes.
 *
 * @param closes - Closing prices, oldest to newest.
 * @param period - RSI period (typically 14).
 * @returns The RSI in [0, 100], or null if insufficient data.
 */
function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return round(100 - 100 / (1 + rs), 1);
}

/**
 * Annualized volatility from daily log returns.
 *
 * @param closes - Closing prices, oldest to newest.
 * @param lookback - Number of most-recent returns to use.
 * @returns Annualized volatility, or null if insufficient data.
 */
function annualizedVolatility(closes: number[], lookback = 30): number | null {
  if (closes.length < 3) return null;
  const returns: number[] = [];
  const start = Math.max(1, closes.length - lookback);
  for (let i = start; i < closes.length; i++) {
    if (closes[i - 1] > 0) returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  return round(Math.sqrt(variance) * Math.sqrt(252), 4);
}

/**
 * Derive technical fields shared by both asset classes from a close series.
 *
 * @param closes - Closing prices, oldest to newest.
 * @returns The technical indicator block.
 */
function buildTechnical(closes: number[]): MarketSnapshot["technical"] {
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  let trend: "uptrend" | "downtrend" | "unknown" = "unknown";
  if (sma50 != null && sma200 != null) trend = sma50 >= sma200 ? "uptrend" : "downtrend";
  return {
    rsi14: rsi(closes, 14),
    sma50,
    sma200,
    trend,
    annualizedVolatility: annualizedVolatility(closes),
  };
}

interface CoinGeckoSearch {
  coins?: Array<{ id: string; symbol: string; name: string; market_cap_rank: number | null }>;
}
interface CoinGeckoMarket {
  current_price: number;
  price_change_percentage_24h: number | null;
  total_volume: number | null;
}
interface CoinGeckoChart {
  prices?: Array<[number, number]>;
}
interface AlphaGlobalQuote {
  "Global Quote"?: Record<string, string>;
  Note?: string;
  Information?: string;
}
interface AlphaDaily {
  "Time Series (Daily)"?: Record<string, Record<string, string>>;
  Note?: string;
  Information?: string;
}
interface AlphaOverview {
  PERatio?: string;
}

/**
 * Provider that fetches real market data and computes technical indicators.
 */
export class MarketDataProvider {
  private readonly coingeckoKey?: string;
  private readonly alphaVantageKey?: string;
  private readonly timeoutMs: number;

  /**
   * Create the market-data provider from application configuration.
   *
   * @param config - Validated application configuration.
   */
  constructor(config: AppConfig) {
    this.coingeckoKey = config.marketData.coingeckoApiKey;
    this.alphaVantageKey = config.marketData.alphaVantageApiKey;
    this.timeoutMs = config.providerTimeoutMs;
  }

  /**
   * Fetch a real market snapshot for a ticker.
   *
   * @param ticker - Asset symbol, e.g. "AAPL", "BTC", or "BTC-USD".
   * @returns A normalized {@link MarketSnapshot} computed from live data.
   * @throws {ProviderError} If data cannot be sourced for the ticker.
   */
  async getSnapshot(ticker: string): Promise<MarketSnapshot> {
    const symbol = ticker.toUpperCase();
    const cryptoBase = symbol.endsWith("-USD") ? symbol.slice(0, -4) : symbol;

    if (symbol.endsWith("-USD") || COMMON_CRYPTO.has(cryptoBase)) {
      return this.getCrypto(cryptoBase);
    }

    if (this.alphaVantageKey) {
      return this.getEquity(symbol);
    }

    // No equity key: attempt crypto resolution as a last resort before failing.
    try {
      return await this.getCrypto(symbol);
    } catch {
      throw new ProviderError(
        `Could not source data for "${ticker}". Equities require ALPHAVANTAGE_API_KEY ` +
          `(free at alphavantage.co); crypto works key-free. Try a symbol like BTC or BTC-USD.`,
      );
    }
  }

  /**
   * Fetch a crypto snapshot from CoinGecko.
   *
   * @param symbol - Crypto symbol (e.g. "BTC").
   * @returns The market snapshot.
   * @throws {ProviderError} If the symbol cannot be resolved.
   */
  private async getCrypto(symbol: string): Promise<MarketSnapshot> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.coingeckoKey) headers["x-cg-demo-api-key"] = this.coingeckoKey;

    const search = await fetchJson<CoinGeckoSearch>(
      `${COINGECKO_BASE}/search?query=${encodeURIComponent(symbol)}`,
      { headers },
      this.timeoutMs,
    );
    const exact = (search.coins ?? [])
      .filter(c => c.symbol.toUpperCase() === symbol)
      .sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9));
    const coin = exact[0] ?? search.coins?.[0];
    if (!coin) throw new ProviderError(`Unknown crypto symbol "${symbol}"`);

    const [markets, chart] = await Promise.all([
      fetchJson<CoinGeckoMarket[]>(
        `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${coin.id}`,
        { headers },
        this.timeoutMs,
      ),
      fetchJson<CoinGeckoChart>(
        `${COINGECKO_BASE}/coins/${coin.id}/market_chart?vs_currency=usd&days=200&interval=daily`,
        { headers },
        this.timeoutMs,
      ),
    ]);

    const market = markets[0];
    if (!market) throw new ProviderError(`No market data for "${symbol}"`);
    const closes = (chart.prices ?? []).map(p => p[1]).filter(n => Number.isFinite(n));

    return {
      ticker: symbol,
      assetClass: "crypto",
      source: "coingecko",
      asOf: new Date().toISOString(),
      quote: {
        price: round(market.current_price, 6),
        changePercent:
          market.price_change_percentage_24h != null
            ? round(market.price_change_percentage_24h, 2)
            : null,
        volume: market.total_volume != null ? Math.round(market.total_volume) : null,
      },
      technical: buildTechnical(closes),
      fundamental: { peRatio: null, valuation: null },
    };
  }

  /**
   * Fetch an equity snapshot from Alpha Vantage.
   *
   * @param symbol - Equity ticker (e.g. "AAPL").
   * @returns The market snapshot.
   * @throws {ProviderError} On rate limits or missing data.
   */
  private async getEquity(symbol: string): Promise<MarketSnapshot> {
    const key = this.alphaVantageKey as string;
    const q = (fn: string, extra = "") =>
      `${ALPHAVANTAGE_BASE}?function=${fn}&symbol=${encodeURIComponent(symbol)}${extra}&apikey=${key}`;

    const [quote, daily, overview] = await Promise.all([
      fetchJson<AlphaGlobalQuote>(q("GLOBAL_QUOTE"), {}, this.timeoutMs),
      fetchJson<AlphaDaily>(q("TIME_SERIES_DAILY", "&outputsize=full"), {}, this.timeoutMs),
      fetchJson<AlphaOverview>(q("OVERVIEW"), {}, this.timeoutMs),
    ]);

    const limitNote = quote.Note || quote.Information || daily.Note || daily.Information;
    if (limitNote) {
      throw new ProviderError(`Alpha Vantage limit/notice: ${limitNote}`);
    }

    const gq = quote["Global Quote"] ?? {};
    const series = daily["Time Series (Daily)"];
    if (!series) throw new ProviderError(`No daily series for equity "${symbol}"`);

    const closes = Object.entries(series)
      .sort(([a], [b]) => (a < b ? -1 : 1)) // oldest -> newest by date string
      .map(([, ohlc]) => Number(ohlc["4. close"]))
      .filter(n => Number.isFinite(n));

    const price = Number(gq["05. price"]) || closes[closes.length - 1];
    const changePctRaw = gq["10. change percent"];
    const changePercent = changePctRaw ? Number(changePctRaw.replace("%", "")) : null;
    const volume = gq["06. volume"] ? Number(gq["06. volume"]) : null;
    const peRatio =
      overview.PERatio && overview.PERatio !== "None" ? Number(overview.PERatio) : null;

    let valuation: string | null = null;
    if (peRatio != null && Number.isFinite(peRatio)) {
      valuation = peRatio > 35 ? "rich" : peRatio < 15 ? "cheap" : "fair";
    }

    return {
      ticker: symbol,
      assetClass: "equity",
      source: "alphavantage",
      asOf: new Date().toISOString(),
      quote: {
        price: round(price, 4),
        changePercent:
          changePercent != null && Number.isFinite(changePercent) ? round(changePercent, 2) : null,
        volume: volume != null && Number.isFinite(volume) ? volume : null,
      },
      technical: buildTechnical(closes),
      fundamental: { peRatio, valuation },
    };
  }
}
