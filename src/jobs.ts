import type { ActionResult } from './processor.ts';

export type JobStatus = 'running' | 'completed' | 'failed';

export interface Job {
  id: string;
  variant: string;
  url: string;
  status: JobStatus;
  actions: ActionResult[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export class JobStore {
  private readonly jobs = new Map<string, Job>();

  constructor(private readonly ttlMs: number = 30 * 60 * 1000) {}

  create(variant: string, url: string): Job {
    this.prune();
    const now = Date.now();
    const job: Job = {
      id: crypto.randomUUID(),
      variant,
      url,
      status: 'running',
      actions: [],
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): Job | undefined {
    this.prune();
    return this.jobs.get(id);
  }

  complete(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'completed';
    job.updatedAt = Date.now();
  }

  fail(id: string, error: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'failed';
    job.error = error;
    job.updatedAt = Date.now();
  }

  private prune(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, job] of this.jobs) {
      if (job.status !== 'running' && job.updatedAt < cutoff) {
        this.jobs.delete(id);
      }
    }
  }
}
