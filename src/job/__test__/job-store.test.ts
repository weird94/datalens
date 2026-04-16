import { describe, expect, it } from 'vitest'
import { JobStore } from '../job-store'

describe('JobStore', () => {
  it('upserts and retrieves job snapshots', () => {
    const store = new JobStore()
    const snapshot = {
      jobId: 'job-1',
      state: 'RUNNING',
      updatedAt: new Date().toISOString(),
    }

    store.upsert(snapshot)

    expect(store.get('job-1')).toEqual(snapshot)
  })

  it('keeps requestId from previous snapshot when progress payload omits it', () => {
    const store = new JobStore()
    store.upsert({
      jobId: 'job-2',
      requestId: 'req-1',
      state: 'PREPARING',
      updatedAt: new Date().toISOString(),
    })

    const next = store.updateFromProgress({
      jobId: 'job-2',
      state: 'RUNNING',
      progress: {
        mainCount: 1,
        nestedCount: 0,
        totalCount: 1,
        step: 'scraping',
        updatedAt: new Date().toISOString(),
      },
    })

    expect(next.requestId).toBe('req-1')
  })
})
