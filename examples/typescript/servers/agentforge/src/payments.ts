/**
 * x402 payment layer for the AgentForge Intelligence Suite.
 *
 * Centralizes construction of the {@link x402ResourceServer}, the per-service
 * payment requirements, and the price arithmetic. Both transports share a single
 * resource server instance so facilitator state (supported kinds, hooks) is
 * initialized exactly once.
 */

import { HTTPFacilitatorClient } from "@x402/core/server";
import type { PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { x402ResourceServer } from "@x402/mcp";

import type { AppConfig } from "./config";
import type { Logger } from "./logger";
import { SERVICES } from "./services";

/**
 * Bundle of payment primitives shared across the MCP and HTTP servers.
 */
export interface PaymentLayer {
  resourceServer: x402ResourceServer;
  /** Per-service pre-built payment requirements, keyed by service name. */
  requirements: Map<string, PaymentRequirements[]>;
  /** Effective (multiplier-adjusted) dollar price string, keyed by service name. */
  effectivePrice: Map<string, string>;
}

/**
 * Apply the configured price multiplier to a base dollar-price string.
 *
 * @param basePrice - Base price such as "$0.01".
 * @param multiplier - Multiplier from configuration.
 * @returns The adjusted price string (e.g. "$0.025").
 */
export function applyPriceMultiplier(basePrice: string, multiplier: number): string {
  const numeric = Number(basePrice.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric) || multiplier === 1) {
    return basePrice;
  }
  const adjusted = numeric * multiplier;
  // USDC has 6 decimals; keep up to 6 significant fractional digits, trim zeros.
  const formatted = adjusted.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `$${formatted}`;
}

/**
 * Initialize the shared x402 resource server and build per-service requirements.
 *
 * @param config - Validated application configuration.
 * @param logger - Logger for initialization diagnostics.
 * @returns A fully-initialized {@link PaymentLayer}.
 */
export async function createPaymentLayer(config: AppConfig, logger: Logger): Promise<PaymentLayer> {
  const facilitatorClient = new HTTPFacilitatorClient({ url: config.facilitatorUrl });
  const resourceServer = new x402ResourceServer(facilitatorClient);
  resourceServer.register(config.network, new ExactEvmScheme());
  // Register Bazaar discovery so both transports can advertise discoverable
  // resources to facilitators and marketplaces such as Agentic.market.
  resourceServer.registerExtension(bazaarResourceServerExtension);

  logger.info("Initializing x402 resource server", {
    facilitator: config.facilitatorUrl,
    network: config.network,
  });
  await resourceServer.initialize();

  const requirements = new Map<string, PaymentRequirements[]>();
  const effectivePrice = new Map<string, string>();

  for (const service of SERVICES) {
    const price = applyPriceMultiplier(service.price, config.priceMultiplier);
    effectivePrice.set(service.name, price);

    const accepts = await resourceServer.buildPaymentRequirements({
      scheme: "exact",
      network: config.network,
      payTo: config.evmAddress,
      price,
      extra: { name: "USDC", version: "2" }, // EIP-712 domain parameters
    });

    requirements.set(service.name, accepts);
    logger.debug("Built payment requirements", { service: service.name, price });
  }

  logger.info("Payment layer ready", { services: SERVICES.length });

  return { resourceServer, requirements, effectivePrice };
}
