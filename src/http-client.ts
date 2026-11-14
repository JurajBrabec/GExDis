import { isAllowedUrl } from './variants.ts';

export const MAX_PAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
// This bounds idle time (no redirect, no chunk of data), not total duration:
// resetIdleTimeout() is called on each redirect hop and each chunk read, so a
// slow-but-flowing 512 MiB download never hits it, while a stalled connection
// still does. AbortSignal.timeout() can't be reset this way, hence the
// manually-managed AbortController.
const IDLE_TIMEOUT_MS = 30_000;

export interface AllowedFetchResult {
  response: Response;
  url: string;
  // Push the idle deadline back out; call on every unit of progress. No-op
  // when the caller supplied its own signal.
  resetIdleTimeout: () => void;
}

export async function fetchAllowed(
  url: string,
  init?: RequestInit,
): Promise<AllowedFetchResult> {
  let current = url;
  const controller = init?.signal ? undefined : new AbortController();
  const signal = init?.signal ?? controller!.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resetIdleTimeout = () => {
    if (!controller) return;
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        controller.abort(
          new DOMException('The operation timed out.', 'TimeoutError'),
        ),
      IDLE_TIMEOUT_MS,
    );
  };
  resetIdleTimeout();
  for (let redirect = 0; redirect <= 10; redirect += 1) {
    if (!isAllowedUrl(current)) throw new Error('Request host is not allowed');
    const response = await fetch(current, {
      ...init,
      signal,
      redirect: 'manual',
    });
    resetIdleTimeout();
    if (response.status < 300 || response.status >= 400) {
      return { response, url: current, resetIdleTimeout };
    }
    const location = response.headers.get('location');
    if (!location) throw new Error('Redirect response has no location');
    await response.body?.cancel();
    current = new URL(location, current).toString();
  }
  throw new Error('Too many redirects');
}

export async function readResponseBytes(
  response: Response,
  maxBytes: number,
  label: string,
  resetIdleTimeout?: () => void,
): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    await response.body?.cancel();
    throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
  }

  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdleTimeout?.();
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (chunks.length === 1) return chunks[0];
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readResponseText(
  response: Response,
  maxBytes: number,
  label: string,
  resetIdleTimeout?: () => void,
): Promise<string> {
  return new TextDecoder().decode(
    await readResponseBytes(response, maxBytes, label, resetIdleTimeout),
  );
}
