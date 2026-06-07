/**
 * Shared HTTP helpers for upstream providers.
 *
 * Wraps the global `fetch` with an abortable timeout and JSON parsing so every
 * provider has consistent timeout and error semantics.
 */

/**
 * Error thrown when an upstream provider call fails or times out.
 */
export class ProviderError extends Error {
  readonly status?: number;

  /**
   * Create a provider error.
   *
   * @param message - Human-readable error message.
   * @param status - Optional upstream HTTP status code.
   */
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

/**
 * Perform a JSON HTTP request with an enforced timeout.
 *
 * @param url - Absolute request URL.
 * @param init - Standard fetch init options.
 * @param timeoutMs - Abort the request after this many milliseconds.
 * @returns The parsed JSON response body typed as `T`.
 * @throws {ProviderError} On non-2xx responses, timeouts, or network errors.
 */
export async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();

    if (!response.ok) {
      throw new ProviderError(
        `Upstream request failed (${response.status}): ${text.slice(0, 300)}`,
        response.status,
      );
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProviderError(`Upstream returned non-JSON response: ${text.slice(0, 200)}`);
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ProviderError(`Upstream request timed out after ${timeoutMs}ms`);
    }
    throw new ProviderError(
      `Upstream request error: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
