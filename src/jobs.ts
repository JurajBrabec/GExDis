import type { ActionResult } from './processor.ts';

export type JobStatus = 'running' | 'completed' | 'failed';

export type JobPhase =
  | 'queued'
  | 'downloading'
  | 'removing'
  | 'unpacking'
  | 'copying'
  | 'completed'
  | 'failed';

export interface JobProgress {
  phase: JobPhase;
  current: number;
  total: number;
  file?: string;
  message: string;
}

export interface Job {
  id: string;
  variant: string;
  url: string;
  status: JobStatus;
  progress: JobProgress;
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
      progress: {
        phase: 'queued',
        current: 0,
        total: 0,
        message: 'Job queued',
      },
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

  updateProgress(id: string, progress: JobProgress): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.progress = progress;
    job.updatedAt = Date.now();
  }

  complete(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'completed';
    job.progress = {
      ...job.progress,
      phase: 'completed',
      message: 'All files processed',
    };
    job.updatedAt = Date.now();
  }

  fail(id: string, error: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'failed';
    job.error = error;
    job.progress = {
      ...job.progress,
      phase: 'failed',
      message: error,
    };
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
