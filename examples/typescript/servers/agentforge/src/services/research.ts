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

import { engineTag, llmJson } from "./llm";
import type { ServiceDefinition, ServiceResult } from "./types";
import { contentWordFrequencies, splitSentences, tokenize } from "./util";

interface LlmBrief {
  thesis: string;
  keyFindings: string[];
  openQuestions: string[];
  suggestedNextSteps: string[];
  keywords?: string[];
}

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
 * Synthesize a research brief via the configured LLM, when available.
 *
 * @param topic - The research topic or question.
 * @param notes - Optional source notes.
 * @param depth - Desired depth.
 * @returns A {@link ServiceResult}, or null to fall back to extractive synthesis.
 */
async function llmBrief(
  topic: string,
  notes: string,
  depth: "brief" | "standard" | "deep",
): Promise<ServiceResult | null> {
  const findingsLimit = depth === "deep" ? 8 : depth === "brief" ? 3 : 5;
  const out = await llmJson<LlmBrief>(
    "You are a rigorous research analyst. Be evidence-driven and avoid fabricating sources. " +
      "Respond ONLY with a JSON object.",
    `Produce a ${depth} research brief on the TOPIC, grounded in the SOURCE NOTES when provided. ` +
      `Return JSON with keys: thesis (string), keyFindings (array of up to ${findingsLimit} strings), ` +
      `openQuestions (array of strings), suggestedNextSteps (array of strings), keywords (array of strings). ` +
      `If notes are insufficient, say so in the thesis rather than inventing facts.\n\n` +
      `TOPIC: ${topic}\n\nSOURCE NOTES:\n${notes || "(none provided)"}`,
  );
  if (!out) return null;
  return {
    summary: `Synthesized a ${depth} LLM brief on "${topic}" with ${out.keyFindings?.length ?? 0} findings.`,
    data: {
      topic,
      depth,
      thesis: out.thesis,
      keyFindings: out.keyFindings ?? [],
      keywords: out.keywords ?? [],
      openQuestions: out.openQuestions ?? [],
      suggestedNextSteps: out.suggestedNextSteps ?? [],
      engine: engineTag(true),
    },
  };
}

/**
 * Synthesize a structured research brief from source notes (extractive).
 *
 * @param topic - The research topic or question.
 * @param notes - Optional source notes.
 * @param depth - Desired depth.
 * @returns A {@link ServiceResult} containing the structured brief.
 */
function extractiveBrief(
  topic: string,
  notes: string,
  depth: "brief" | "standard" | "deep",
): ServiceResult {
  const findingsLimit = depth === "deep" ? 8 : depth === "brief" ? 3 : 5;

  const sourceNotes = notes.trim();
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
    summary: `Synthesized a ${depth} brief on "${topic}" with ${findings.length} findings.`,
    data: {
      topic,
      depth,
      thesis,
      keyFindings: findings,
      keywords,
      openQuestions,
      suggestedNextSteps: nextSteps,
      sourceSentenceCount: splitSentences(sourceNotes).length,
      engine: engineTag(false),
    },
  };
}

/**
 * Synthesize a research brief, preferring the LLM and falling back to extractive.
 *
 * @param args - Raw arguments validated against the service schema.
 * @returns A {@link ServiceResult} containing the structured brief.
 */
async function handler(args: Record<string, unknown>): Promise<ServiceResult> {
  const { topic, notes, depth } = schema.parse(args);
  const resolvedDepth = depth ?? "standard";
  const sourceNotes = notes ?? "";
  return (
    (await llmBrief(topic, sourceNotes, resolvedDepth)) ??
    extractiveBrief(topic, sourceNotes, resolvedDepth)
  );
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
