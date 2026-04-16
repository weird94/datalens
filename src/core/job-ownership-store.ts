import {
  JOB_OWNERSHIP_CONFLICT_ERROR_CODE,
  SessionIsolationError,
} from './session-isolation-error'

function buildJobOwnershipConflictMessage(jobId: string, ownerSessionId: string): string {
  return `Job ${jobId} is already owned by session ${ownerSessionId}`
}

export { JOB_OWNERSHIP_CONFLICT_ERROR_CODE }

export class JobOwnershipStore {
  private readonly ownerByJob = new Map<string, string>()
  private readonly jobsBySession = new Map<string, Set<string>>()

  assignJob(sessionId: string, jobId: string): void {
    const ownerSessionId = this.ownerByJob.get(jobId)
    if (ownerSessionId && ownerSessionId !== sessionId) {
      throw new SessionIsolationError(
        JOB_OWNERSHIP_CONFLICT_ERROR_CODE,
        buildJobOwnershipConflictMessage(jobId, ownerSessionId)
      )
    }

    this.ownerByJob.set(jobId, sessionId)
    const jobs = this.jobsBySession.get(sessionId) ?? new Set<string>()
    jobs.add(jobId)
    this.jobsBySession.set(sessionId, jobs)
  }

  assertOwnership(sessionId: string, jobId: string): void {
    const ownerSessionId = this.ownerByJob.get(jobId)
    if (!ownerSessionId || ownerSessionId === sessionId) {
      return
    }

    throw new SessionIsolationError(
      JOB_OWNERSHIP_CONFLICT_ERROR_CODE,
      buildJobOwnershipConflictMessage(jobId, ownerSessionId)
    )
  }

  getOwnerSessionId(jobId: string): string | null {
    return this.ownerByJob.get(jobId) ?? null
  }

  releaseSession(sessionId: string): void {
    const jobs = this.jobsBySession.get(sessionId)
    if (!jobs) {
      return
    }

    jobs.forEach(jobId => {
      this.ownerByJob.delete(jobId)
    })
    this.jobsBySession.delete(sessionId)
  }
}
