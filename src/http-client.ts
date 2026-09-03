import { isAllowedUrl } from './variants.ts';

export async function fetchAllowed(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  let current = url;
  for (let redirect = 0; redirect <= 10; redirect += 1) {
    if (!isAllowedUrl(current)) throw new Error('Request host is not allowed');
    const response = await fetch(current, { ...init, redirect: 'manual' });
    console.log(response);
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error('Redirect response has no location');
    current = new URL(location, current).toString();
  }
  throw new Error('Too many redirects');
}
