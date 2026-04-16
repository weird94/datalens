import type { JsonValue } from '../bridge/protocol'

export interface JobProgress {
  mainCount: number
  nestedCount: number
  totalCount: number
  step: string
  updatedAt: string
}

export interface JobError {
  code: string
  message: string
  retriable?: boolean
  detail?: JsonValue
}

export interface JobSnapshot {
  jobId: string
  requestId?: string
  state: string
  progress?: JobProgress
  error?: JobError
  updatedAt: string
}

export class JobStore {
  private readonly jobs = new Map<string, JobSnapshot>()

  upsert(snapshot: JobSnapshot): JobSnapshot {
    this.jobs.set(snapshot.jobId, snapshot)
    return snapshot
  }

  updateFromProgress(payload: {
    jobId: string
    state: string
    progress: JobProgress
    error?: JobError
    requestId?: string
  }): JobSnapshot {
    const previous = this.jobs.get(payload.jobId)

    const snapshot: JobSnapshot = {
      jobId: payload.jobId,
      state: payload.state,
      progress: payload.progress,
      ...(payload.error ? { error: payload.error } : {}),
      ...(payload.requestId ? { requestId: payload.requestId } : {}),
      updatedAt: new Date().toISOString(),
      ...(previous?.requestId && !payload.requestId ? { requestId: previous.requestId } : {}),
    }

    this.jobs.set(payload.jobId, snapshot)
    return snapshot
  }

  get(jobId: string): JobSnapshot | null {
    return this.jobs.get(jobId) || null
  }

  list(): JobSnapshot[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
}
