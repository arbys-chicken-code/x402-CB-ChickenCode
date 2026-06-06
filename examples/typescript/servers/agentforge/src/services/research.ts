/**
 * Research brief synthesis service.
 *
 * Turns a topic and a set of source notes into a structured research brief:
 * a thesis, key findings, contrasting angles, open questions, and suggested
 * next steps. Operates on the provided notes (retrieval-free) so it runs without
 * external API access; point {@link gatherContext} at a real retriever / LLM in
 * production.
 */

import { z } from "zod";

import type { ServiceDefinition, ServiceResult } from "./types";
import { contentWordFrequencies, splitSentences, tokenize } from "./util";

const schema = z.object({
  topic: z
    .string()
    .min(1, "topic is required")
    .max(300, "topic must be 300 characters or fewer")
    .describe("The research topic or question"),
  notes: z
    .string()
    .max(50_000, "notes must be 50,000 characters or fewer")
    .optional()
    .describe("Optional source material / notes to synthesize the brief from"),
  depth: z
    .enum(["brief", "standard", "deep"])
    .optional()
    .describe("Desired depth of the brief (default standard)"),
});

/**
 * Select the most salient sentences from the notes as evidence.
 *
 * @param notes - Raw source notes.
 * @param limit - Maximum number of findings to surface.
 * @returns Ranked evidence sentences.
 */
function gatherContext(notes: string, limit: number): string[] {
  const sentences = splitSentences(notes);
  if (sentences.length === 0) return [];
  const freq = contentWordFrequencies(tokenize(notes));
  const maxFreq = Math.max(1, ...freq.values());

  return sentences
    .map(sentence => {
      const tokens = tokenize(sentence);
      const score =
        tokens.reduce((sum, t) => sum + (freq.get(t) ?? 0) / maxFreq, 0) /
        Math.sqrt(tokens.length || 1);
      return { sentence, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.sentence);
}

/**
 * Synthesize a structured research brief.
 *
 * @param args - Raw arguments validated against the service schema.
 * @returns A {@link ServiceResult} containing the structured brief.
 */
function handler(args: Record<string, unknown>): ServiceResult {
  const { topic, notes, depth } = schema.parse(args);
  const findingsLimit = depth === "deep" ? 8 : depth === "brief" ? 3 : 5;

  const sourceNotes = notes?.trim() ?? "";
  const findings = gatherContext(sourceNotes, findingsLimit);
  const keywords = [...contentWordFrequencies(tokenize(`${topic} ${sourceNotes}`)).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);

  const thesis =
    findings.length > 0
      ? `Based on the provided sources, ${topic} is best understood through ${keywords
          .slice(0, 3)
          .join(", ")}.`
      : `Insufficient source material was provided to form an evidence-backed thesis on ${topic}.`;

  const openQuestions = [
    `What are the strongest counter-arguments regarding ${topic}?`,
    `Which sources are most authoritative on ${keywords[0] ?? topic}?`,
    `What recent developments could change the conclusions about ${topic}?`,
  ].slice(0, findingsLimit > 3 ? 3 : 2);

  const nextSteps = [
    "Corroborate the key findings against at least two independent sources.",
    "Quantify any claims that are currently qualitative.",
    findings.length === 0 ? "Supply source notes to enable evidence-backed synthesis." : null,
  ].filter((s): s is string => Boolean(s));

  return {
    summary: `Synthesized a ${depth ?? "standard"} brief on "${topic}" with ${findings.length} findings.`,
    data: {
      topic,
      depth: depth ?? "standard",
      thesis,
      keyFindings: findings,
      keywords,
      openQuestions,
      suggestedNextSteps: nextSteps,
      sourceSentenceCount: splitSentences(sourceNotes).length,
    },
  };
}

/**
 * Research brief synthesis service definition.
 */
export const researchService: ServiceDefinition = {
  name: "research_brief",
  title: "Research Brief Synthesis",
  category: "research",
  description:
    "Synthesize a structured research brief (thesis, key findings, open questions, next steps) " +
    "from a topic and optional source notes. Retrieval-free and deterministic by design.",
  price: "$0.03",
  shape: schema.shape,
  inputSchema: {
    type: "object",
    properties: {
      topic: { type: "string", description: "The research topic or question" },
      notes: {
        type: "string",
        description: "Optional source material / notes to synthesize the brief from",
      },
      depth: {
        type: "string",
        enum: ["brief", "standard", "deep"],
        description: "Desired depth of the brief (default standard)",
      },
    },
    required: ["topic"],
  },
  exampleInput: {
    topic: "Agentic payments with x402",
    notes:
      "x402 uses HTTP 402 to request stablecoin payment. Facilitators verify and settle on-chain. " +
      "Agents pay without API keys. MCP exposes paid tools to AI agents.",
    depth: "standard",
  },
  exampleOutput: {
    topic: "Agentic payments with x402",
    thesis: "Based on the provided sources, ...",
    keyFindings: ["x402 uses HTTP 402 to request stablecoin payment."],
    openQuestions: ["What are the strongest counter-arguments..."],
  },
  http: { method: "POST", path: "/v1/research-brief" },
  handler,
};
