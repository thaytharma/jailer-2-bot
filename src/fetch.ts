const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface FetchOptions {
  attempts?: number;
  timeoutMs?: number;
  /** Injected in tests to avoid real waiting. */
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
}

export interface RequestSpec {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Request a URL as a browser would, retrying transient failures. */
export async function fetchText(
  url: string,
  spec: RequestSpec = {},
  { attempts = 3, timeoutMs = 20_000, sleep = defaultSleep, fetchImpl = fetch }: FetchOptions = {},
): Promise<string> {
  let lastError = '';

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url, {
        method: spec.method ?? 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/json',
          'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
          ...spec.headers,
        },
        ...(spec.body !== undefined ? { body: spec.body } : {}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < attempts) await sleep(attempt * 2_000);
    }
  }

  throw new Error(`failed after ${attempts} attempts: ${lastError}`);
}

/** What a source needs to reach the network; swapped for a fake in tests. */
export type Http = (url: string, spec?: RequestSpec) => Promise<string>;

export const http: Http = (url, spec) => fetchText(url, spec);
