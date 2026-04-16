import { describe, expect, it } from 'vitest'
import {
  JOB_OWNERSHIP_CONFLICT_ERROR_CODE,
  JobOwnershipStore,
} from '../job-ownership-store'

describe('JobOwnershipStore', () => {
  it('binds jobs to the owning session', () => {
    const store = new JobOwnershipStore()

    store.assignJob('session-a', 'job-1')

    expect(store.getOwnerSessionId('job-1')).toBe('session-a')
  })

  it('rejects another session trying to access an owned job', () => {
    const store = new JobOwnershipStore()

    store.assignJob('session-a', 'job-1')

    expect(() => store.assertOwnership('session-b', 'job-1')).toThrowError(
      expect.objectContaining({
        code: JOB_OWNERSHIP_CONFLICT_ERROR_CODE,
      })
    )
  })

  it('releases owned jobs when the session closes', () => {
    const store = new JobOwnershipStore()

    store.assignJob('session-a', 'job-1')
    store.releaseSession('session-a')

    expect(store.getOwnerSessionId('job-1')).toBeNull()
  })
})
