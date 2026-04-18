// =============================================================================
// FOUNDRY — Generic Retry + Timeout Utility
// Wraps outbound HTTP/API calls with exponential backoff and timeouts.
// =============================================================================

export interface RetryConfig {
  maxRetries?: number;      // default 2
  baseDelayMs?: number;     // default 1000
  timeoutMs?: number;       // default 30000
  retryableStatuses?: number[]; // default [429, 500, 502, 503, 504]
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {},
): Promise<T> {
  const {
    maxRetries = 2,
    baseDelayMs = 1000,
    timeoutMs = 30000,
    retryableStatuses = [429, 500, 502, 503, 504],
  } = config;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Wrap in timeout
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const status = (err as any)?.status ?? (err as any)?.statusCode;
      if (status && !retryableStatuses.includes(status)) throw lastError;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError ?? new Error('Failed after retries');
}
