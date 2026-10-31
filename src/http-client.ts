import { isAllowedUrl } from './variants.ts';

export const MAX_PAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

export async function fetchAllowed(
  url: string,
  init?: RequestInit,
): Promise<{ response: Response; url: string }> {
  let current = url;
  const signal = init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS);
  for (let redirect = 0; redirect <= 10; redirect += 1) {
    if (!isAllowedUrl(current)) throw new Error('Request host is not allowed');
    const response = await fetch(current, {
      ...init,
      signal,
      redirect: 'manual',
    });
    if (response.status < 300 || response.status >= 400) {
      return { response, url: current };
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
): Promise<string> {
  return new TextDecoder().decode(
    await readResponseBytes(response, maxBytes, label),
  );
}
