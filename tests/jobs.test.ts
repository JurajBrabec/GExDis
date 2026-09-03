import { expect, test } from 'bun:test';
import { JobStore } from '../src/jobs.ts';

test('creates a running job with a shared, mutable actions array', () => {
  const store = new JobStore();
  const job = store.create('github', 'https://github.com/acme/tool');

  expect(job.status).toBe('running');
  expect(job.actions).toEqual([]);
  expect(store.get(job.id)).toBe(job);

  job.actions.push({ variant: 'github', url: 'https://x', status: 'downloaded' });
  expect(store.get(job.id)?.actions).toHaveLength(1);
});

test('completes and fails jobs', () => {
  const store = new JobStore();
  const completed = store.create('github', 'https://github.com/acme/tool');
  store.complete(completed.id);
  expect(store.get(completed.id)?.status).toBe('completed');

  const failed = store.create('github', 'https://github.com/acme/tool');
  store.fail(failed.id, 'boom');
  const job = store.get(failed.id);
  expect(job?.status).toBe('failed');
  expect(job?.error).toBe('boom');
});

test('returns undefined for an unknown job id', () => {
  const store = new JobStore();
  expect(store.get('missing')).toBeUndefined();
});

test('prunes terminal jobs older than the ttl', () => {
  const store = new JobStore(-1);
  const job = store.create('github', 'https://github.com/acme/tool');
  store.complete(job.id);

  expect(store.get(job.id)).toBeUndefined();
});

test('does not prune jobs still running', () => {
  const store = new JobStore(-1);
  const job = store.create('github', 'https://github.com/acme/tool');

  expect(store.get(job.id)).toBeDefined();
});
