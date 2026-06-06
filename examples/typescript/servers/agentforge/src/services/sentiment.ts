/**
 * Sentiment analysis service.
 *
 * Lexicon-based polarity scoring with negation handling and intensifier
 * weighting. Returns a normalized score in [-1, 1], a discrete label, and the
 * tokens that drove the classification.
 */

import { z } from "zod";

import type { ServiceDefinition, ServiceResult } from "./types";
import { round, tokenize } from "./util";

const POSITIVE = new Map<string, number>([
  ["good", 1],
  ["great", 1.5],
  ["excellent", 2],
  ["amazing", 2],
  ["love", 2],
  ["loved", 2],
  ["wonderful", 1.8],
  ["fantastic", 2],
  ["happy", 1.4],
  ["best", 1.8],
  ["awesome", 1.8],
  ["positive", 1],
  ["profit", 1.2],
  ["gain", 1.2],
  ["bullish", 1.6],
  ["win", 1.3],
  ["success", 1.4],
  ["strong", 1.1],
  ["improve", 1],
  ["improved", 1.1],
  ["recommend", 1.2],
  ["reliable", 1.1],
  ["fast", 0.8],
  ["efficient", 1],
  ["delight", 1.6],
]);

const NEGATIVE = new Map<string, number>([
  ["bad", 1],
  ["terrible", 2],
  ["awful", 2],
  ["hate", 2],
  ["hated", 2],
  ["worst", 2],
  ["poor", 1.3],
  ["sad", 1.2],
  ["angry", 1.4],
  ["negative", 1],
  ["loss", 1.3],
  ["lose", 1.3],
  ["bearish", 1.6],
  ["fail", 1.5],
  ["failed", 1.6],
  ["broken", 1.4],
  ["bug", 1.1],
  ["slow", 1],
  ["disappointed", 1.7],
  ["disappointing", 1.7],
  ["expensive", 0.9],
  ["unreliable", 1.4],
  ["crash", 1.5],
  ["weak", 1.1],
  ["scam", 2],
]);

const INTENSIFIERS = new Set(["very", "extremely", "really", "so", "incredibly", "super"]);
const NEGATORS = new Set(["not", "no", "never", "n't", "without", "hardly", "barely"]);

const schema = z.object({
  text: z
    .string()
    .min(1, "text is required")
    .max(20_000, "text must be 20,000 characters or fewer")
    .describe("The text to analyze for sentiment"),
});

/**
 * Score the sentiment of a body of text.
 *
 * @param args - Raw arguments validated against the service schema.
 * @returns A {@link ServiceResult} with score, label, and contributing tokens.
 */
function handler(args: Record<string, unknown>): ServiceResult {
  const { text } = schema.parse(args);
  const tokens = tokenize(text);

  let rawScore = 0;
  let matched = 0;
  const drivers: Array<{ token: string; weight: number }> = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const base = POSITIVE.get(token) ?? -(NEGATIVE.get(token) ?? 0);
    if (base === 0) continue;

    let weight = base;
    const prev = tokens[i - 1];
    const prev2 = tokens[i - 2];
    if (prev && INTENSIFIERS.has(prev)) weight *= 1.5;
    if ((prev && NEGATORS.has(prev)) || (prev2 && NEGATORS.has(prev2))) weight *= -1;

    rawScore += weight;
    matched += 1;
    drivers.push({ token, weight: round(weight, 2) });
  }

  // Normalize using a smooth squashing function so longer texts do not saturate.
  const normalized = matched === 0 ? 0 : round(Math.tanh(rawScore / Math.sqrt(matched + 4)), 4);

  let label: "positive" | "negative" | "neutral";
  if (normalized > 0.15) label = "positive";
  else if (normalized < -0.15) label = "negative";
  else label = "neutral";

  const confidence = round(Math.min(1, Math.abs(normalized) + matched / (tokens.length + 1)), 4);

  drivers.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

  return {
    summary: `Sentiment is ${label} (score ${normalized}).`,
    data: {
      label,
      score: normalized,
      confidence,
      tokensAnalyzed: tokens.length,
      sentimentTokens: matched,
      topDrivers: drivers.slice(0, 8),
    },
  };
}

/**
 * Sentiment analysis service definition.
 */
export const sentimentService: ServiceDefinition = {
  name: "sentiment_analysis",
  title: "Sentiment Analysis",
  category: "nlp",
  description:
    "Classify the emotional polarity of text with negation and intensifier handling. " +
    "Returns a normalized score in [-1, 1], a label, confidence, and the driving tokens.",
  price: "$0.005",
  shape: schema.shape,
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text to analyze for sentiment" },
    },
    required: ["text"],
  },
  exampleInput: { text: "I absolutely love this product, it works great and is very reliable!" },
  exampleOutput: {
    label: "positive",
    score: 0.86,
    confidence: 0.92,
    tokensAnalyzed: 13,
    sentimentTokens: 3,
    topDrivers: [{ token: "love", weight: 2 }],
  },
  http: { method: "POST", path: "/v1/sentiment" },
  handler,
};
