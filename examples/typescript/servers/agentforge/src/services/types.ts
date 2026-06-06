/**
 * Shared types for AgentForge intelligence services.
 *
 * A {@link ServiceDefinition} is the single source of truth for a service: it
 * describes pricing, validation, discovery metadata, and the handler itself.
 * Both the MCP server and the HTTP API are generated from the same definitions,
 * guaranteeing the two transports never drift apart.
 */

import type { ZodRawShape } from "zod";

/**
 * Coarse grouping used for catalog presentation and marketplace filtering.
 */
export type ServiceCategory = "nlp" | "research" | "markets" | "developer-tools" | "content";

/**
 * Normalized output of every service handler.
 */
export interface ServiceResult {
  /** Structured, machine-readable result payload. */
  data: Record<string, unknown>;
  /** Optional one-line natural-language summary for human operators / agents. */
  summary?: string;
}

/**
 * Self-describing definition of a single paid intelligence service.
 */
export interface ServiceDefinition {
  /** Canonical snake_case id. Doubles as the MCP tool name. */
  name: string;
  /** Human-friendly title for catalog/marketplace display. */
  title: string;
  /** Category used for grouping and discovery. */
  category: ServiceCategory;
  /** One or two sentence description shown to agents. */
  description: string;
  /** Base price as an x402 dollar string, e.g. "$0.01". */
  price: string;
  /** Zod raw shape used to validate input on both transports. */
  shape: ZodRawShape;
  /** JSON Schema (draft 2020-12 fragment) advertised via Bazaar discovery. */
  inputSchema: Record<string, unknown>;
  /** Example input used in discovery metadata and documentation. */
  exampleInput: Record<string, unknown>;
  /** Example output used in discovery metadata and documentation. */
  exampleOutput: Record<string, unknown>;
  /** HTTP binding for the REST surface of this service. */
  http: {
    method: "POST";
    path: string;
  };
  /**
   * Pure(ish) handler implementing the service logic.
   *
   * @param args - Raw, unvalidated arguments (validated inside via the shape).
   * @returns The structured {@link ServiceResult}.
   */
  handler: (args: Record<string, unknown>) => ServiceResult | Promise<ServiceResult>;
}
