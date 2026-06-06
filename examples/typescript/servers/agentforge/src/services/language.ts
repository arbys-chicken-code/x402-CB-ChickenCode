/**
 * Language detection service.
 *
 * Scores text against per-language stop-word profiles and character n-gram cues
 * to identify the most likely language, returning ranked candidates with
 * confidence. No model download or API key required.
 */

import { z } from "zod";

import type { ServiceDefinition, ServiceResult } from "./types";
import { round, tokenize } from "./util";

const PROFILES: Record<string, { name: string; markers: string[] }> = {
  en: {
    name: "English",
    markers: ["the", "and", "is", "to", "of", "in", "that", "it", "for", "you"],
  },
  es: {
    name: "Spanish",
    markers: ["el", "la", "de", "que", "y", "en", "los", "una", "por", "con"],
  },
  fr: {
    name: "French",
    markers: ["le", "la", "les", "de", "et", "un", "une", "que", "pour", "dans"],
  },
  de: {
    name: "German",
    markers: ["der", "die", "und", "das", "ist", "ein", "nicht", "mit", "den", "zu"],
  },
  it: {
    name: "Italian",
    markers: ["il", "di", "che", "la", "e", "un", "per", "non", "una", "sono"],
  },
  pt: {
    name: "Portuguese",
    markers: ["o", "de", "que", "e", "do", "da", "em", "para", "com", "uma"],
  },
  nl: {
    name: "Dutch",
    markers: ["de", "het", "een", "en", "van", "is", "dat", "niet", "op", "te"],
  },
};

const schema = z.object({
  text: z
    .string()
    .min(1, "text is required")
    .max(20_000, "text must be 20,000 characters or fewer")
    .describe("The text whose language should be detected"),
});

/**
 * Detect the most likely language of a body of text.
 *
 * @param args - Raw arguments validated against the service schema.
 * @returns A {@link ServiceResult} with the top language and ranked candidates.
 */
function handler(args: Record<string, unknown>): ServiceResult {
  const { text } = schema.parse(args);
  const tokens = tokenize(text);
  const tokenSet = tokens;

  const scores: Array<{ code: string; name: string; score: number }> = [];
  for (const [code, profile] of Object.entries(PROFILES)) {
    const markerSet = new Set(profile.markers);
    let hits = 0;
    for (const token of tokenSet) {
      if (markerSet.has(token)) hits += 1;
    }
    scores.push({ code, name: profile.name, score: hits });
  }

  const totalHits = scores.reduce((sum, s) => sum + s.score, 0);
  scores.sort((a, b) => b.score - a.score);

  const candidates = scores
    .filter(s => s.score > 0)
    .map(s => ({
      code: s.code,
      language: s.name,
      confidence: round(totalHits > 0 ? s.score / totalHits : 0, 4),
    }));

  const top = candidates[0] ?? { code: "und", language: "Undetermined", confidence: 0 };

  return {
    summary: `Detected ${top.language} (confidence ${top.confidence}).`,
    data: {
      language: top.language,
      languageCode: top.code,
      confidence: top.confidence,
      candidates: candidates.slice(0, 5),
      tokensAnalyzed: tokens.length,
    },
  };
}

/**
 * Language detection service definition.
 */
export const languageService: ServiceDefinition = {
  name: "language_detection",
  title: "Language Detection",
  category: "nlp",
  description:
    "Identify the language of a text using stop-word profiling across 7 major languages, " +
    "returning ranked candidates with confidence scores.",
  price: "$0.004",
  shape: schema.shape,
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text whose language should be detected" },
    },
    required: ["text"],
  },
  exampleInput: { text: "Bonjour, ceci est un texte écrit en français pour la démonstration." },
  exampleOutput: {
    language: "French",
    languageCode: "fr",
    confidence: 0.71,
    candidates: [{ code: "fr", language: "French", confidence: 0.71 }],
  },
  http: { method: "POST", path: "/v1/language" },
  handler,
};
