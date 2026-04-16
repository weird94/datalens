import type { RegressionManifestCaseEntry, RegressionCaseRow } from './types'

export interface RunBatchInput {
  cases: RegressionCaseRow[]
  runOneCase: (testCase: RegressionCaseRow) => Promise<RegressionManifestCaseEntry>
  persistManifest: (entries: RegressionManifestCaseEntry[]) => Promise<void>
}

export async function runBatch(input: RunBatchInput): Promise<RegressionManifestCaseEntry[]> {
  const entries: RegressionManifestCaseEntry[] = []

  for (const testCase of input.cases) {
    const entry = await input.runOneCase(testCase)
    entries.push(entry)
    await input.persistManifest(entries)
  }

  return entries
}
