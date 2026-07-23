export interface ReliableFetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  retryBaseMs?: number;
}

type FetchLike = typeof fetch;

export async function reliableFetch(
  input: string | URL,
  options: ReliableFetchOptions = {},
  fetcher: FetchLike = fetch
): Promise<Response> {
  const timeoutMs = positiveInteger(options.timeoutMs, process.env.HTTP_TIMEOUT_MS, 15_000);
  const retries = nonNegativeInteger(options.retries, process.env.HTTP_RETRY_COUNT, 2);
  const retryBaseMs = positiveInteger(
    options.retryBaseMs,
    process.env.HTTP_RETRY_BASE_MS,
    250
  );
  const { timeoutMs: _, retries: __, retryBaseMs: ___, ...request } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetcher(input, {
        redirect: "manual",
        ...request,
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!retryableStatus(response.status) || attempt === retries) return response;
      await response.body?.cancel().catch(() => undefined);
      await delay(retryDelay(response, attempt, retryBaseMs));
    } catch (error) {
      lastError = error;
      if (attempt === retries) throw error;
      await delay(exponentialDelay(attempt, retryBaseMs));
    }
  }
  throw lastError;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryDelay(response: Response, attempt: number, baseMs: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, 30_000);
    }
    const timestamp = new Date(retryAfter).getTime();
    if (Number.isFinite(timestamp)) {
      return Math.min(Math.max(timestamp - Date.now(), 0), 30_000);
    }
  }
  return exponentialDelay(attempt, baseMs);
}

function exponentialDelay(attempt: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** attempt, 10_000);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function positiveInteger(
  direct: number | undefined,
  environment: string | undefined,
  fallback: number
): number {
  const value = direct ?? Number(environment);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(
  direct: number | undefined,
  environment: string | undefined,
  fallback: number
): number {
  const value = direct ?? Number(environment);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}
