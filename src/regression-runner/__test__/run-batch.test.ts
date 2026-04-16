import { describe, expect, it, vi } from 'vitest'
import { runBatch } from '../run-batch'
import type { RegressionCaseRow, RegressionManifestCaseEntry } from '../types'

function createCase(rowIndex: number): RegressionCaseRow {
  return {
    rowIndex,
    environment: '全球',
    site: 'site',
    page: `page-${rowIndex}`,
    category: '新闻',
    url: `https://example.com/${rowIndex}`,
    scrapePrompt: `Prompt ${rowIndex}`,
    level: 'P0(Major)',
  }
}

describe('runBatch', () => {
  it('runs cases sequentially and writes each result in order', async () => {
    const events: string[] = []
    const persistManifest = vi.fn(async (_entries: RegressionManifestCaseEntry[]) => {})
    const runOneCase = vi.fn(async (testCase: RegressionCaseRow): Promise<RegressionManifestCaseEntry> => {
      events.push(`start:${testCase.rowIndex}`)
      await Promise.resolve()
      events.push(`finish:${testCase.rowIndex}`)
      return {
        rowIndex: testCase.rowIndex,
        caseDirName: `case-${testCase.rowIndex}`,
        runnerState: 'COMPLETED',
      }
    })

    const results = await runBatch({
      cases: [createCase(2), createCase(3), createCase(4)],
      runOneCase,
      persistManifest,
    })

    expect(results).toHaveLength(3)
    expect(events).toEqual([
      'start:2',
      'finish:2',
      'start:3',
      'finish:3',
      'start:4',
      'finish:4',
    ])
    expect(persistManifest).toHaveBeenCalledTimes(3)
  })
})
