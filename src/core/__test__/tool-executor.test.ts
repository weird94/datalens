import { describe, expect, it, vi } from 'vitest'
import type { BridgeCommandName, JsonObject } from '../../bridge/protocol'
import { JobOwnershipStore } from '../job-ownership-store'
import { SessionStateStore } from '../session-state-store'
import { TabLeaseManager } from '../tab-lease-manager'
import { ToolExecutor } from '../tool-executor'
import { ToolRegistry } from '../tool-registry'

const FILE_ID_A = '11111111-1111-4111-8111-111111111111'
const FILE_ID_B = '22222222-2222-4222-8222-222222222222'

function createExecutor(
  sendCommand: (
    name: BridgeCommandName,
    payload: JsonObject,
    options?: { requestId?: string; jobId?: string; timeoutMs?: number }
  ) => Promise<JsonObject>
): ToolExecutor {
  return new ToolExecutor(
    new ToolRegistry(),
    sendCommand,
    new SessionStateStore(),
    new TabLeaseManager(),
    new JobOwnershipStore()
  )
}

function createJob(state: string, remoteFileId?: string): JsonObject {
  return {
    jobId: 'job-1',
    requestId: 'req-job',
    tabId: 7,
    state,
    progress: {
      mainCount: 1,
      nestedCount: 0,
      totalCount: 1,
      step: state === 'CANCELED' ? 'state:canceled' : `state:${state.toLowerCase()}`,
      updatedAt: '2026-05-12T00:00:00.000Z',
    },
    ...(remoteFileId ? { remoteFileId } : {}),
  }
}

describe('ToolExecutor', () => {
  it('passes current-thread sourceFileIds to data-workbench payloads', async () => {
    vi.useFakeTimers()

    try {
      const sendCommand = vi.fn<
        [BridgeCommandName, JsonObject, { requestId?: string; jobId?: string; timeoutMs?: number }?],
        Promise<JsonObject>
      >(async commandName => {
        if (commandName === 'ai_tool.start_scrape') {
          return {
            requestId: 'req-start',
            job: createJob('RUNNING'),
          }
        }

        if (commandName === 'ai_tool.get_scrape_job_status') {
          return {
            requestId: 'req-status',
            job: createJob('COMPLETED', FILE_ID_A),
          }
        }

        return {
          assets: [],
          scope: 'current_thread',
        }
      })
      const executor = createExecutor(sendCommand)

      const startPromise = executor.invoke('startScrape', { jobId: 'job-1' }, 'session-a')
      await vi.advanceTimersByTimeAsync(2_000)
      await startPromise

      await executor.invoke('listWorkspaceAssets', {}, 'session-a')
      await executor.invoke('inspectWorkspaceAsset', { fileName: 'rows.csv' }, 'session-a')
      await executor.invoke(
        'runDataCode',
        {
          fileNames: ['rows.csv'],
          code: 'print("ok")',
          language: 'python',
        },
        'session-a'
      )
      await executor.invoke('listWorkspaceAssets', { scope: 'workspace' }, 'session-a')

      expect(sendCommand).toHaveBeenNthCalledWith(
        3,
        'data_workbench.list_workspace_assets',
        {
          sourceFileIds: [FILE_ID_A],
        },
        expect.objectContaining({ requestId: expect.any(String) })
      )
      expect(sendCommand).toHaveBeenNthCalledWith(
        4,
        'data_workbench.inspect_workspace_asset',
        {
          fileName: 'rows.csv',
          sourceFileIds: [FILE_ID_A],
        },
        expect.objectContaining({ requestId: expect.any(String) })
      )
      expect(sendCommand).toHaveBeenNthCalledWith(
        5,
        'data_workbench.run_data_code',
        expect.objectContaining({
          fileNames: ['rows.csv'],
          sourceFileIds: [FILE_ID_A],
        }),
        expect.objectContaining({ requestId: expect.any(String) })
      )
      expect(sendCommand).toHaveBeenNthCalledWith(
        6,
        'data_workbench.list_workspace_assets',
        {
          scope: 'workspace',
        },
        expect.objectContaining({ requestId: expect.any(String) })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('polls startScrape to a terminal state and returns completionStatus', async () => {
    vi.useFakeTimers()

    try {
      const sendCommand = vi.fn<
        [BridgeCommandName, JsonObject, { requestId?: string; jobId?: string; timeoutMs?: number }?],
        Promise<JsonObject>
      >(async commandName => {
        if (commandName === 'ai_tool.start_scrape') {
          return {
            requestId: 'req-start',
            job: createJob('RUNNING'),
          }
        }

        return {
          requestId: 'req-status',
          job: createJob('COMPLETED', FILE_ID_A),
        }
      })
      const executor = createExecutor(sendCommand)

      const resultPromise = executor.invoke(
        'startScrape',
        {
          tabId: 7,
          scrapeConfig: {
            tableInfo: {},
          },
          maxRecords: 10,
        },
        'session-a'
      )

      expect(sendCommand).toHaveBeenCalledTimes(1)
      expect(sendCommand).toHaveBeenNthCalledWith(
        1,
        'ai_tool.start_scrape',
        expect.objectContaining({
          requestId: expect.any(String),
          tabId: 7,
          scrapeConfig: {
            tableInfo: {},
          },
          maxRecords: 10,
        }),
        expect.objectContaining({ requestId: expect.any(String) })
      )

      await vi.advanceTimersByTimeAsync(2_000)
      const result = await resultPromise

      expect(sendCommand).toHaveBeenNthCalledWith(
        2,
        'ai_tool.get_scrape_job_status',
        expect.objectContaining({
          requestId: expect.any(String),
          jobId: 'job-1',
        }),
        expect.objectContaining({
          requestId: expect.any(String),
          jobId: 'job-1',
        })
      )
      expect(result).toMatchObject({
        completionStatus: 'completed',
        job: {
          state: 'COMPLETED',
          remoteFileId: FILE_ID_A,
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('normalizes canceled scrape status to stopped and marks stoppedByUser', async () => {
    vi.useFakeTimers()

    try {
      const sendCommand = vi.fn<
        [BridgeCommandName, JsonObject, { requestId?: string; jobId?: string; timeoutMs?: number }?],
        Promise<JsonObject>
      >(async commandName => {
        if (commandName === 'ai_tool.start_scrape') {
          return {
            requestId: 'req-start',
            job: createJob('RUNNING'),
          }
        }

        return {
          requestId: 'req-status',
          job: createJob('CANCELED'),
        }
      })
      const executor = createExecutor(sendCommand)

      const resultPromise = executor.invoke('startScrape', { jobId: 'job-1' }, 'session-a')
      await vi.advanceTimersByTimeAsync(2_000)
      const result = await resultPromise

      expect(result).toMatchObject({
        completionStatus: 'stopped',
        stoppedByUser: true,
        job: {
          state: 'STOPPED',
          progress: {
            step: 'state:stopped',
          },
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops an active scrape when the MCP request is aborted', async () => {
    const abortController = new AbortController()
    const sendCommand = vi.fn<
      [BridgeCommandName, JsonObject, { requestId?: string; jobId?: string; timeoutMs?: number }?],
      Promise<JsonObject>
    >(async commandName => {
      if (commandName === 'ai_tool.start_scrape') {
        return {
          requestId: 'req-start',
          job: createJob('RUNNING'),
        }
      }

      if (commandName === 'ai_tool.stop_scrape') {
        return {
          requestId: 'req-stop',
          job: createJob('STOPPED'),
        }
      }

      throw new Error(`Unexpected command: ${commandName}`)
    })
    const executor = createExecutor(sendCommand)

    const resultPromise = executor.invoke('startScrape', { jobId: 'job-1' }, 'session-a', {
      abortSignal: abortController.signal,
    })
    await Promise.resolve()
    abortController.abort()

    await expect(resultPromise).resolves.toMatchObject({
      completionStatus: 'stopped',
      stoppedByUser: true,
      job: {
        state: 'STOPPED',
      },
    })
    expect(sendCommand).toHaveBeenNthCalledWith(
      2,
      'ai_tool.stop_scrape',
      expect.objectContaining({
        jobId: 'job-1',
        requestId: expect.any(String),
      }),
      expect.objectContaining({
        jobId: 'job-1',
        requestId: expect.any(String),
        timeoutMs: 30_000,
      })
    )
  })

  it('keeps tracked source files isolated per MCP session', async () => {
    vi.useFakeTimers()

    try {
      const sendCommand = vi.fn<
        [BridgeCommandName, JsonObject, { requestId?: string; jobId?: string; timeoutMs?: number }?],
        Promise<JsonObject>
      >(async (commandName, payload) => {
        if (commandName === 'ai_tool.start_scrape') {
          return {
            requestId: 'req-start',
            job: {
              ...createJob('RUNNING'),
              jobId: payload.jobId,
            },
          }
        }

        if (commandName === 'ai_tool.get_scrape_job_status') {
          const remoteFileId = payload.jobId === 'job-a' ? FILE_ID_A : FILE_ID_B
          return {
            requestId: 'req-status',
            job: {
              ...createJob('COMPLETED', remoteFileId),
              jobId: payload.jobId,
            },
          }
        }

        return {
          assets: [],
          scope: 'current_thread',
        }
      })
      const executor = createExecutor(sendCommand)

      const sessionAPromise = executor.invoke('startScrape', { jobId: 'job-a' }, 'session-a')
      await vi.advanceTimersByTimeAsync(2_000)
      await sessionAPromise

      const sessionBPromise = executor.invoke('startScrape', { jobId: 'job-b' }, 'session-b')
      await vi.advanceTimersByTimeAsync(2_000)
      await sessionBPromise

      await executor.invoke('listWorkspaceAssets', {}, 'session-a')
      await executor.invoke('listWorkspaceAssets', {}, 'session-b')

      expect(sendCommand).toHaveBeenNthCalledWith(
        5,
        'data_workbench.list_workspace_assets',
        {
          sourceFileIds: [FILE_ID_A],
        },
        expect.objectContaining({ requestId: expect.any(String) })
      )
      expect(sendCommand).toHaveBeenNthCalledWith(
        6,
        'data_workbench.list_workspace_assets',
        {
          sourceFileIds: [FILE_ID_B],
        },
        expect.objectContaining({ requestId: expect.any(String) })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('records persisted runDataCode output ids without exposing bridge metadata', async () => {
    const sendCommand = vi.fn<
      [BridgeCommandName, JsonObject, { requestId?: string; jobId?: string; timeoutMs?: number }?],
      Promise<JsonObject>
    >(async commandName => {
      if (commandName === 'data_workbench.run_data_code') {
        return {
          metadata: {
            outputFileIds: [FILE_ID_A],
          },
          result: {
            outputFiles: [
              {
                contentType: 'text/csv',
                kind: 'cleaned_csv',
                name: 'clean.csv',
                rowCount: 1,
              },
            ],
            status: 'completed',
            stderr: '',
            stdout: 'ok',
            tables: [],
            warnings: [],
            charts: [],
          },
        }
      }

      return {
        assets: [],
        scope: 'current_thread',
      }
    })
    const executor = createExecutor(sendCommand)

    const result = await executor.invoke(
      'runDataCode',
      {
        fileNames: ['rows.csv'],
        code: 'print("ok")',
        language: 'python',
        mode: 'persist',
      },
      'session-a'
    )
    await executor.invoke('listWorkspaceAssets', {}, 'session-a')

    expect(result).toEqual({
      outputFiles: [
        {
          contentType: 'text/csv',
          kind: 'cleaned_csv',
          name: 'clean.csv',
          rowCount: 1,
        },
      ],
      status: 'completed',
      stderr: '',
      stdout: 'ok',
      tables: [],
      warnings: [],
      charts: [],
    })
    expect(sendCommand).toHaveBeenNthCalledWith(
      2,
      'data_workbench.list_workspace_assets',
      {
        sourceFileIds: [FILE_ID_A],
      },
      expect.objectContaining({ requestId: expect.any(String) })
    )
  })
})
