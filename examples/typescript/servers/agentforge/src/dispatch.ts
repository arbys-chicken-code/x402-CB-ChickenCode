/**
 * Transport-agnostic service execution.
 *
 * Wraps a {@link ServiceDefinition} handler with validation-error handling,
 * metrics recording, and a stable response envelope used identically by the MCP
 * and HTTP transports.
 */

import { ZodError } from "zod";

import type { Logger } from "./logger";
import type { Metrics } from "./metrics";
import { ProviderError } from "./providers";
import type { ServiceDefinition } from "./services";

/**
 * Stable response envelope returned by every service over every transport.
 */
export interface ServiceEnvelope {
  ok: boolean;
  service: string;
  result?: Record<string, unknown>;
  summary?: string;
  error?: { type: string; message: string; details?: unknown };
  generatedAt: string;
}

/**
 * Execute a service handler and produce a normalized {@link ServiceEnvelope}.
 *
 * Never throws: validation and runtime errors are converted into a structured
 * error envelope with `ok: false` so callers can render a consistent response.
 *
 * @param service - The service definition to execute.
 * @param args - Raw, unvalidated input arguments.
 * @param metrics - Metrics collector for invocation/failure counters.
 * @param logger - Scoped logger.
 * @returns A normalized response envelope.
 */
export async function runService(
  service: ServiceDefinition,
  args: Record<string, unknown>,
  metrics: Metrics,
  logger: Logger,
): Promise<ServiceEnvelope> {
  metrics.recordInvocation(service.name);
  const generatedAt = new Date().toISOString();

  try {
    const result = await service.handler(args);
    logger.debug("Service executed", { service: service.name });
    return {
      ok: true,
      service: service.name,
      result: result.data,
      summary: result.summary,
      generatedAt,
    };
  } catch (error) {
    metrics.recordFailure(service.name);

    if (error instanceof ZodError) {
      logger.warn("Validation failed", {
        service: service.name,
        issues: error.issues.length,
      });
      return {
        ok: false,
        service: service.name,
        error: {
          type: "validation_error",
          message: "Input validation failed.",
          details: error.issues.map(issue => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        generatedAt,
      };
    }

    // Surface upstream provider failures (e.g. market-data unavailable, missing
    // key) with their actionable message so callers understand what to fix.
    if (error instanceof ProviderError) {
      logger.warn("Provider error", { service: service.name, message: error.message });
      return {
        ok: false,
        service: service.name,
        error: { type: "provider_error", message: error.message },
        generatedAt,
      };
    }

    logger.error("Service handler threw", {
      service: service.name,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      service: service.name,
      error: {
        type: "internal_error",
        message: "The service failed to process the request.",
      },
      generatedAt,
    };
  }
}

/**
 * Extract the paying wallet address from an x402 payment payload, if present.
 *
 * @param paymentPayload - The x402 payment payload from a verified request.
 * @returns The payer address, or "unknown" when it cannot be determined.
 */
export function extractPayer(paymentPayload: unknown): string {
  const payload = paymentPayload as
    | { payload?: { authorization?: { from?: string }; from?: string } }
    | undefined;
  return payload?.payload?.authorization?.from ?? payload?.payload?.from ?? "unknown";
}
