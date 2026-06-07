/**
 * Entity & structured-data extraction service.
 *
 * Pulls high-signal structured entities out of unstructured text: emails, URLs,
 * phone numbers, monetary amounts, percentages, dates, stock tickers, hashtags,
 * mentions, and candidate proper-noun phrases.
 */

import { z } from "zod";

import { engineTag, llmJson } from "./llm";
import type { ServiceDefinition, ServiceResult } from "./types";

interface LlmEntities {
  people?: string[];
  organizations?: string[];
  locations?: string[];
  products?: string[];
}

const PATTERNS: Record<string, RegExp> = {
  emails: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  urls: /https?:\/\/[^\s)]+/g,
  phoneNumbers: /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g,
  money: /[$€£¥]\s?\d+(?:[.,]\d+)*(?:\s?(?:k|m|bn|billion|million|thousand))?/gi,
  percentages: /\d+(?:\.\d+)?\s?%/g,
  hashtags: /#[A-Za-z0-9_]+/g,
  mentions: /@[A-Za-z0-9_]+/g,
  tickers: /\$[A-Z]{1,5}\b/g,
  dates:
    /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?)\b/g,
};

const schema = z.object({
  text: z
    .string()
    .min(1, "text is required")
    .max(50_000, "text must be 50,000 characters or fewer")
    .describe("The text to extract entities from"),
});

/**
 * Deduplicate matches while preserving order.
 *
 * @param matches - Raw regex matches.
 * @returns Unique, trimmed matches.
 */
function unique(matches: string[]): string[] {
  return [...new Set(matches.map(m => m.trim()))];
}

/**
 * Extract candidate proper-noun phrases (sequences of capitalized words).
 *
 * @param text - Input text.
 * @returns Unique candidate entity phrases.
 */
function extractProperNouns(text: string): string[] {
  const matches = text.match(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})\b/g) ?? [];
  // Drop single common sentence-starters that are unlikely to be entities.
  return unique(matches.filter(m => m.length > 2)).slice(0, 25);
}

/**
 * Extract structured entities from text.
 *
 * Pattern-based extraction (emails, URLs, money, dates, ...) always runs. When
 * an LLM is configured, named-entity categories (people, organizations,
 * locations, products) are added for true NER coverage.
 *
 * @param args - Raw arguments validated against the service schema.
 * @returns A {@link ServiceResult} with grouped entities and a total count.
 */
async function handler(args: Record<string, unknown>): Promise<ServiceResult> {
  const { text } = schema.parse(args);

  const entities: Record<string, string[]> = {};
  let total = 0;

  for (const [kind, pattern] of Object.entries(PATTERNS)) {
    const found = unique(text.match(pattern) ?? []);
    if (found.length > 0) {
      entities[kind] = found;
      total += found.length;
    }
  }

  const named = await llmJson<LlmEntities>(
    "You are a precise named-entity recognition engine. Respond ONLY with a JSON object.",
    `Extract named entities from the TEXT. Return JSON with keys people, organizations, ` +
      `locations, products — each an array of unique strings (empty if none).\n\nTEXT:\n${text}`,
  );

  let usedLlm = false;
  if (named) {
    usedLlm = true;
    for (const key of ["people", "organizations", "locations", "products"] as const) {
      const values = unique(named[key] ?? []);
      if (values.length > 0) {
        entities[key] = values;
        total += values.length;
      }
    }
  } else {
    const properNouns = extractProperNouns(text);
    if (properNouns.length > 0) {
      entities.properNouns = properNouns;
      total += properNouns.length;
    }
  }

  return {
    summary: `Extracted ${total} entities across ${Object.keys(entities).length} categories.`,
    data: {
      entities,
      totalEntities: total,
      categories: Object.keys(entities),
      engine: engineTag(usedLlm),
    },
  };
}

/**
 * Entity extraction service definition.
 */
export const entitiesService: ServiceDefinition = {
  name: "entity_extraction",
  title: "Entity & Data Extraction",
  category: "nlp",
  description:
    "Extract structured entities from unstructured text: emails, URLs, phone numbers, money, " +
    "percentages, dates, stock tickers, hashtags, mentions, and proper-noun phrases.",
  price: "$0.008",
  shape: schema.shape,
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text to extract entities from" },
    },
    required: ["text"],
  },
  exampleInput: {
    text: "Email ana@forge.ai or visit https://agentic.market. $AAPL rose 4% on Mar 3, 2026.",
  },
  exampleOutput: {
    entities: {
      emails: ["ana@forge.ai"],
      urls: ["https://agentic.market"],
      percentages: ["4%"],
      tickers: ["$AAPL"],
      dates: ["Mar 3, 2026"],
    },
    totalEntities: 5,
    categories: ["emails", "urls", "percentages", "tickers", "dates"],
  },
  http: { method: "POST", path: "/v1/entities" },
  handler,
};
