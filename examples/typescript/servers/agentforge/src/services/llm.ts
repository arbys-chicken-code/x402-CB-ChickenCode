/**
 * Helper bridging services to the LLM provider.
 *
 * Encapsulates the "use the real model when configured, otherwise return null
 * so the caller falls back to its built-in algorithm" pattern, keeping each
 * service handler concise.
 */

import { getLlm } from "../providers";

/**
 * Run an LLM JSON completion if a model is configured.
 *
 * @param system - System prompt establishing role and output contract.
 * @param user - User prompt with the task and input data.
 * @returns Parsed JSON of type `T`, or null when the LLM is unconfigured or errors.
 */
export async function llmJson<T>(system: string, user: string): Promise<T | null> {
  const llm = getLlm();
  if (!llm.isConfigured()) return null;
  try {
    return await llm.completeJson<T>({ system, user });
  } catch {
    return null;
  }
}

/**
 * Whether a real LLM backend is configured.
 *
 * @returns True if the LLM provider has credentials.
 */
export function llmEnabled(): boolean {
  return getLlm().isConfigured();
}

/**
 * A short engine tag describing which backend produced a result.
 *
 * @param usedLlm - Whether the LLM path produced the result.
 * @returns "llm:<model>" or "builtin".
 */
export function engineTag(usedLlm: boolean): string {
  return usedLlm ? `llm:${getLlm().modelName()}` : "builtin";
}
