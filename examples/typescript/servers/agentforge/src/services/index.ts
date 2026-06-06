/**
 * Service registry for the AgentForge Intelligence Suite.
 *
 * This is the canonical, ordered list of every paid service in the bundle. Both
 * the MCP and HTTP transports iterate this array, so adding a new service here
 * automatically exposes it over both surfaces and in the discovery catalog.
 */

import { codeReviewService } from "./codeReview";
import { entitiesService } from "./entities";
import { languageService } from "./language";
import { marketIntelligenceService } from "./marketIntelligence";
import { readabilityService } from "./readability";
import { researchService } from "./research";
import { sentimentService } from "./sentiment";
import { summarizeService } from "./summarize";
import type { ServiceDefinition } from "./types";

/**
 * All paid services in the suite, in catalog display order.
 */
export const SERVICES: ServiceDefinition[] = [
  sentimentService,
  summarizeService,
  entitiesService,
  languageService,
  readabilityService,
  researchService,
  marketIntelligenceService,
  codeReviewService,
];

/**
 * Look up a service definition by its canonical name.
 *
 * @param name - Canonical service id (e.g. "sentiment_analysis").
 * @returns The matching {@link ServiceDefinition}, or undefined.
 */
export function getService(name: string): ServiceDefinition | undefined {
  return SERVICES.find(service => service.name === name);
}

export type { ServiceDefinition, ServiceResult, ServiceCategory } from "./types";
