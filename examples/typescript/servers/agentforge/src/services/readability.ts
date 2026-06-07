/**
 * Readability scoring service.
 *
 * Computes standard readability indices (Flesch Reading Ease, Flesch–Kincaid
 * Grade Level, and approximate Gunning Fog) plus structural statistics, and maps
 * the result to an audience recommendation.
 */

import { z } from "zod";

import type { ServiceDefinition, ServiceResult } from "./types";
import { clamp, countSyllables, round, splitSentences, tokenize } from "./util";

const schema = z.object({
  text: z
    .string()
    .min(1, "text is required")
    .max(50_000, "text must be 50,000 characters or fewer")
    .describe("The text to score for readability"),
});

/**
 * Map a Flesch Reading Ease score to a plain-language audience label.
 *
 * @param score - Flesch Reading Ease score.
 * @returns A descriptive audience band.
 */
function audienceFor(score: number): string {
  if (score >= 90) return "5th grade — very easy";
  if (score >= 70) return "7th grade — easy";
  if (score >= 60) return "8th–9th grade — plain English";
  if (score >= 50) return "10th–12th grade — fairly difficult";
  if (score >= 30) return "college — difficult";
  return "graduate — very difficult";
}

/**
 * Compute readability metrics for a body of text.
 *
 * @param args - Raw arguments validated against the service schema.
 * @returns A {@link ServiceResult} with indices, structure stats, and guidance.
 */
function handler(args: Record<string, unknown>): ServiceResult {
  const { text } = schema.parse(args);

  const sentences = splitSentences(text);
  const words = tokenize(text);
  const sentenceCount = Math.max(1, sentences.length);
  const wordCount = Math.max(1, words.length);

  let syllables = 0;
  let complexWords = 0;
  for (const word of words) {
    const s = countSyllables(word);
    syllables += s;
    if (s >= 3) complexWords += 1;
  }

  const wordsPerSentence = wordCount / sentenceCount;
  const syllablesPerWord = syllables / wordCount;

  const flesch = round(206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord, 2);
  const fleschKincaid = round(0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59, 2);
  const gunningFog = round(0.4 * (wordsPerSentence + 100 * (complexWords / wordCount)), 2);

  const readingTimeSeconds = round((wordCount / 200) * 60, 0); // ~200 wpm

  return {
    summary: `Flesch Reading Ease ${clamp(flesch, 0, 100)} (${audienceFor(flesch)}).`,
    data: {
      fleschReadingEase: clamp(flesch, 0, 100),
      fleschKincaidGrade: Math.max(0, fleschKincaid),
      gunningFogIndex: Math.max(0, gunningFog),
      audience: audienceFor(flesch),
      engine: "builtin",
      statistics: {
        wordCount,
        sentenceCount,
        complexWordCount: complexWords,
        wordsPerSentence: round(wordsPerSentence, 2),
        syllablesPerWord: round(syllablesPerWord, 2),
        estimatedReadingTimeSeconds: readingTimeSeconds,
      },
    },
  };
}

/**
 * Readability scoring service definition.
 */
export const readabilityService: ServiceDefinition = {
  name: "readability_score",
  title: "Readability Scoring",
  category: "content",
  description:
    "Compute Flesch Reading Ease, Flesch–Kincaid Grade, and Gunning Fog indices with structural " +
    "statistics and an audience recommendation — ideal for content QA pipelines.",
  price: "$0.006",
  shape: schema.shape,
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text to score for readability" },
    },
    required: ["text"],
  },
  exampleInput: {
    text: "The quick brown fox jumps over the lazy dog. It was a bright cold day in April.",
  },
  exampleOutput: {
    fleschReadingEase: 89.75,
    fleschKincaidGrade: 2.3,
    gunningFogIndex: 3.6,
    audience: "5th grade — very easy",
    statistics: { wordCount: 16, sentenceCount: 2 },
  },
  http: { method: "POST", path: "/v1/readability" },
  handler,
};
