/**
 * Extractive text summarization service.
 *
 * Ranks sentences by normalized content-word frequency (a compact TextRank-style
 * heuristic) and returns the top sentences in their original order, along with
 * extracted keywords and compression statistics.
 */

import { z } from "zod";

import type { ServiceDefinition, ServiceResult } from "./types";
import { contentWordFrequencies, round, splitSentences, tokenize } from "./util";

const schema = z.object({
  text: z
    .string()
    .min(1, "text is required")
    .max(50_000, "text must be 50,000 characters or fewer")
    .describe("The text to summarize"),
  maxSentences: z.coerce
    .number()
    .int()
    .min(1)
    .max(15)
    .optional()
    .describe("Maximum number of sentences in the summary (default 3)"),
});

/**
 * Produce an extractive summary and keywords for a body of text.
 *
 * @param args - Raw arguments validated against the service schema.
 * @returns A {@link ServiceResult} with the summary, keywords, and stats.
 */
function handler(args: Record<string, unknown>): ServiceResult {
  const { text, maxSentences } = schema.parse(args);
  const limit = maxSentences ?? 3;

  const sentences = splitSentences(text);
  const freq = contentWordFrequencies(tokenize(text));
  const maxFreq = Math.max(1, ...freq.values());

  const scored = sentences.map((sentence, index) => {
    const tokens = tokenize(sentence);
    if (tokens.length === 0) return { sentence, index, score: 0 };
    let score = 0;
    for (const token of tokens) {
      score += (freq.get(token) ?? 0) / maxFreq;
    }
    // Length normalization discourages cherry-picking very long sentences.
    return { sentence, index, score: round(score / Math.sqrt(tokens.length), 4) };
  });

  const summarySentences = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(limit, sentences.length))
    .sort((a, b) => a.index - b.index)
    .map(s => s.sentence);

  const keywords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  const summary = summarySentences.join(" ");
  const compression = text.length > 0 ? round(1 - summary.length / text.length, 4) : 0;

  return {
    summary: `Condensed ${sentences.length} sentences into ${summarySentences.length}.`,
    data: {
      summaryText: summary,
      summarySentences,
      keywords,
      originalSentenceCount: sentences.length,
      summarySentenceCount: summarySentences.length,
      compressionRatio: compression,
    },
  };
}

/**
 * Text summarization service definition.
 */
export const summarizeService: ServiceDefinition = {
  name: "text_summarization",
  title: "Text Summarization",
  category: "nlp",
  description:
    "Extractive summarization that ranks sentences by content-word salience and returns " +
    "the most informative ones in reading order, plus keywords and compression stats.",
  price: "$0.01",
  shape: schema.shape,
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text to summarize" },
      maxSentences: {
        type: "integer",
        minimum: 1,
        maximum: 15,
        description: "Maximum number of sentences in the summary (default 3)",
      },
    },
    required: ["text"],
  },
  exampleInput: {
    text:
      "x402 is an open payment protocol for the web. It lets servers charge for resources using " +
      "the HTTP 402 status code. AI agents can pay automatically using stablecoins. This removes " +
      "the need for API keys and manual billing.",
    maxSentences: 2,
  },
  exampleOutput: {
    summaryText:
      "x402 is an open payment protocol for the web. AI agents can pay automatically using stablecoins.",
    keywords: [{ word: "x402", count: 1 }],
    compressionRatio: 0.42,
  },
  http: { method: "POST", path: "/v1/summarize" },
  handler,
};
