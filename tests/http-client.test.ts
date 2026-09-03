import { afterEach, expect, mock, test } from 'bun:test';
import { fetchAllowed } from '../src/http-client.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('follows allowed redirects', async () => {
  let calls = 0;
  globalThis.fetch = mock(async (url: string) => {
    calls += 1;
    return calls === 1
      ? new Response(null, {
          status: 302,
          headers: { location: 'https://github.com/acme/tool' },
        })
      : new Response('ok');
  }) as unknown as typeof fetch;
  const { response, url } = await fetchAllowed('https://github.com/acme/start');
  expect(await response.text()).toBe('ok');
  expect(url).toBe('https://github.com/acme/tool');
  expect(calls).toBe(2);
});

test('rejects redirects to unapproved hosts', async () => {
  globalThis.fetch = mock(
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/file' },
      }),
  ) as unknown as typeof fetch;
  await expect(fetchAllowed('https://github.com/acme/start')).rejects.toThrow(
    'Request host is not allowed',
  );
});
