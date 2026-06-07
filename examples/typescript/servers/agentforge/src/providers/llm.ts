/**
 * OpenAI-compatible LLM provider.
 *
 * Powers the production-grade output of the NLP, research, and code-review
 * services. Any provider exposing the OpenAI Chat Completions API works
 * (OpenAI, Azure OpenAI, OpenRouter, Together, Groq, or a self-hosted gateway)
 * by setting `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL`.
 *
 * When no API key is configured, {@link LlmProvider.isConfigured} returns false
 * and callers fall back to their built-in deterministic algorithms.
 */

import type { AppConfig } from "../config";
import { fetchJson, ProviderError } from "./http";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Options for a single LLM completion request.
 */
export interface CompletionRequest {
  /** System prompt establishing the model's role and output contract. */
  system: string;
  /** User prompt containing the task and input data. */
  user: string;
  /** When true, request a strict JSON object response. */
  json?: boolean;
  /** Sampling temperature (default 0.2 for deterministic, analytical output). */
  temperature?: number;
  /** Maximum tokens to generate. */
  maxTokens?: number;
}

/**
 * Thin client over an OpenAI-compatible Chat Completions endpoint.
 */
export class LlmProvider {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  /**
   * Create the LLM provider from application configuration.
   *
   * @param config - Validated application configuration.
   */
  constructor(config: AppConfig) {
    this.apiKey = config.llm.apiKey;
    this.baseUrl = config.llm.baseUrl.replace(/\/$/, "");
    this.model = config.llm.model;
    this.timeoutMs = config.providerTimeoutMs;
  }

  /**
   * Whether a real LLM backend is configured.
   *
   * @returns True when an API key is present.
   */
  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * The configured model identifier (for metadata/labeling).
   *
   * @returns The model name.
   */
  modelName(): string {
    return this.model;
  }

  /**
   * Run a chat completion and return the assistant message content.
   *
   * @param request - The completion request.
   * @returns The raw assistant text content.
   * @throws {ProviderError} If the LLM is not configured or the call fails.
   */
  async complete(request: CompletionRequest): Promise<string> {
    if (!this.apiKey) {
      throw new ProviderError("LLM provider is not configured (LLM_API_KEY missing)");
    }

    const body: Record<string, unknown> = {
      model: this.model,
      temperature: request.temperature ?? 0.2,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
    };
    if (request.maxTokens) body.max_tokens = request.maxTokens;
    if (request.json) body.response_format = { type: "json_object" };

    const data = await fetchJson<ChatCompletionResponse>(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      this.timeoutMs,
    );

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new ProviderError("LLM returned an empty response");
    }
    return content;
  }

  /**
   * Run a completion expected to return a JSON object and parse it.
   *
   * @param request - The completion request (json mode is forced on).
   * @returns The parsed JSON object typed as `T`.
   * @throws {ProviderError} If the response is not valid JSON.
   */
  async completeJson<T>(request: CompletionRequest): Promise<T> {
    const raw = await this.complete({ ...request, json: true });
    // Some gateways wrap JSON in markdown fences; strip them defensively.
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      throw new ProviderError(`LLM returned non-JSON content: ${cleaned.slice(0, 200)}`);
    }
  }
}
