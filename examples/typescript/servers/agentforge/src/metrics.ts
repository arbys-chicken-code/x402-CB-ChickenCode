/**
 * Lightweight in-process metrics + revenue ledger.
 *
 * Tracks per-service call counts, settled revenue, and recent settlement
 * receipts. Exposed via the `/metrics` and `/receipts` HTTP endpoints so an
 * operator (or the marketplace) can observe live usage. Swap for Prometheus /
 * a database in production; the recording API stays the same.
 */

/**
 * A single settled-payment receipt retained for observability.
 */
export interface Receipt {
  service: string;
  transport: "mcp" | "http";
  payer: string;
  amount: string;
  asset: string;
  network: string;
  transaction: string;
  timestampMs: number;
}

interface ServiceStats {
  invocations: number;
  paidInvocations: number;
  failures: number;
  rateLimited: number;
  settledAmountAtomic: bigint;
}

/**
 * Aggregates usage and revenue metrics across both transports.
 */
export class Metrics {
  private readonly startedAtMs = Date.now();
  private readonly perService = new Map<string, ServiceStats>();
  private readonly recentReceipts: Receipt[] = [];
  private readonly maxReceipts: number;

  /**
   * Create a metrics collector.
   *
   * @param maxReceipts - Maximum number of recent receipts to retain in memory.
   */
  constructor(maxReceipts = 100) {
    this.maxReceipts = maxReceipts;
  }

  /**
   * Record that a service handler was invoked (before payment outcome is known).
   *
   * @param service - Canonical service id.
   */
  recordInvocation(service: string): void {
    this.stats(service).invocations += 1;
  }

  /**
   * Record a handler-level failure (validation error, internal error, etc.).
   *
   * @param service - Canonical service id.
   */
  recordFailure(service: string): void {
    this.stats(service).failures += 1;
  }

  /**
   * Record that a request was rejected by the rate limiter.
   *
   * @param service - Canonical service id.
   */
  recordRateLimited(service: string): void {
    this.stats(service).rateLimited += 1;
  }

  /**
   * Record a successfully settled payment and store its receipt.
   *
   * @param receipt - The settlement receipt to record.
   */
  recordSettlement(receipt: Receipt): void {
    const stats = this.stats(receipt.service);
    stats.paidInvocations += 1;
    try {
      stats.settledAmountAtomic += BigInt(receipt.amount);
    } catch {
      // Non-numeric amount; skip revenue accumulation but keep the receipt.
    }

    this.recentReceipts.unshift(receipt);
    if (this.recentReceipts.length > this.maxReceipts) {
      this.recentReceipts.length = this.maxReceipts;
    }
  }

  /**
   * Produce a JSON-serializable snapshot of all metrics.
   *
   * @returns An object describing uptime, totals, and per-service breakdowns.
   */
  snapshot(): Record<string, unknown> {
    const services: Record<string, unknown> = {};
    let totalInvocations = 0;
    let totalPaid = 0;
    let totalRevenueAtomic = 0n;

    for (const [service, stats] of this.perService.entries()) {
      totalInvocations += stats.invocations;
      totalPaid += stats.paidInvocations;
      totalRevenueAtomic += stats.settledAmountAtomic;
      services[service] = {
        invocations: stats.invocations,
        paidInvocations: stats.paidInvocations,
        failures: stats.failures,
        rateLimited: stats.rateLimited,
        settledAmountAtomic: stats.settledAmountAtomic.toString(),
      };
    }

    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAtMs) / 1000),
      totals: {
        invocations: totalInvocations,
        paidInvocations: totalPaid,
        settledRevenueAtomic: totalRevenueAtomic.toString(),
      },
      services,
    };
  }

  /**
   * Return the most recent settlement receipts (newest first).
   *
   * @param limit - Maximum number of receipts to return.
   * @returns A list of recent {@link Receipt} objects.
   */
  receipts(limit = 25): Receipt[] {
    return this.recentReceipts.slice(0, limit);
  }

  /**
   * Get (or lazily create) the stats bucket for a service.
   *
   * @param service - Canonical service id.
   * @returns The mutable {@link ServiceStats} for the service.
   */
  private stats(service: string): ServiceStats {
    let stats = this.perService.get(service);
    if (!stats) {
      stats = {
        invocations: 0,
        paidInvocations: 0,
        failures: 0,
        rateLimited: 0,
        settledAmountAtomic: 0n,
      };
      this.perService.set(service, stats);
    }
    return stats;
  }
}
