import { describe, expect, it, vi } from 'vitest'
import { JobStore } from '../../job/job-store'
import { CommandRouter } from '../command-router'
import { ExtensionConnectionManager } from '../extension-connection-manager'

describe('CommandRouter', () => {
  it('surfaces an explicit bridge-unavailable error when the extension is not connected', async () => {
    vi.useFakeTimers()

    try {
      const router = new CommandRouter(new ExtensionConnectionManager(), new JobStore())
      const resultPromise = router.sendCommand(
        'ai_tool.open_workspace_tab',
        {
          requestId: 'req-1',
          url: 'https://example.com',
        },
        { requestId: 'req-1' }
      )
      const assertion = expect(resultPromise).rejects.toThrow(
        'Bridge unavailable: extension not connected'
      )

      await vi.advanceTimersByTimeAsync(60_250)

      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})
