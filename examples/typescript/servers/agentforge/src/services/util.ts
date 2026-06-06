/**
 * Small, dependency-free text and math helpers shared across services.
 *
 * The implementations here are deliberately self-contained: an example should
 * run with `pnpm install` and no external API keys, while still producing
 * deterministic, plausible, and genuinely useful output.
 */

/**
 * Deterministic 32-bit string hash (FNV-1a variant).
 *
 * @param input - String to hash.
 * @returns A non-negative 32-bit integer hash.
 */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Create a deterministic pseudo-random generator (mulberry32) from a seed.
 *
 * Used so seemingly "live" outputs (e.g. market signals) are stable for a given
 * input, which keeps examples and tests reproducible.
 *
 * @param seed - Numeric seed.
 * @returns A function returning the next float in [0, 1).
 */
export function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Round a number to a fixed number of decimal places.
 *
 * @param value - Value to round.
 * @param decimals - Number of decimal places.
 * @returns The rounded number.
 */
export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Clamp a number into an inclusive range.
 *
 * @param value - Value to clamp.
 * @param min - Lower bound.
 * @param max - Upper bound.
 * @returns The clamped value.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Split prose into sentences using a conservative regex.
 *
 * @param text - Input text.
 * @returns Trimmed, non-empty sentences.
 */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Tokenize text into lowercased word tokens.
 *
 * @param text - Input text.
 * @returns Array of word tokens.
 */
export function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .match(/[a-z0-9']+/g)
      ?.filter(Boolean) ?? []
  );
}

/**
 * Count syllables in a word using a lightweight heuristic.
 *
 * @param word - A single lowercased word.
 * @returns Estimated syllable count (minimum 1).
 */
export function countSyllables(word: string): number {
  const cleaned = word.replace(/[^a-z]/g, "");
  if (cleaned.length <= 3) return 1;
  const groups = cleaned
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "")
    .match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "then",
  "else",
  "when",
  "at",
  "by",
  "for",
  "with",
  "about",
  "against",
  "between",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "to",
  "from",
  "up",
  "down",
  "in",
  "out",
  "on",
  "off",
  "over",
  "under",
  "again",
  "further",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "of",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "them",
  "his",
  "her",
  "its",
  "our",
  "their",
  "as",
  "so",
  "than",
  "too",
  "very",
  "can",
  "will",
  "just",
  "not",
  "no",
  "yes",
  "s",
  "t",
  "don",
  "now",
]);

/**
 * Test whether a token is a common English stop word.
 *
 * @param token - Lowercased token.
 * @returns True if the token is a stop word.
 */
export function isStopWord(token: string): boolean {
  return STOP_WORDS.has(token);
}

/**
 * Compute frequency of content words (stop words removed).
 *
 * @param tokens - Pre-tokenized words.
 * @returns Map of token to frequency.
 */
export function contentWordFrequencies(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const token of tokens) {
    if (isStopWord(token) || token.length < 2) continue;
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  return freq;
}
