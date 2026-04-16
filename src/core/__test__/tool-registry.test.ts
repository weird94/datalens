import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolRegistry } from '../tool-registry'

const createdDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(async dir => {
      await fs.rm(dir, { recursive: true, force: true })
    })
  )
})

describe('ToolRegistry', () => {
  it('executes debug_get_logs and renders readable multiline text', async () => {
    const registry = new ToolRegistry()
    const tool = registry.get('debug_get_logs')
    expect(tool).not.toBeNull()
    if (!tool || !tool.execute) {
      throw new Error('debug_get_logs tool is not available')
    }

    const sendCommand = vi.fn(async () => ({
      items: [
        {
          id: 'log-1',
          timestamp: '2026-03-22T10:00:00.000Z',
          level: 'error',
          source: 'background',
          scope: 'mcp-bridge',
          message: 'Bridge command failed',
          context: {
            requestId: 'req-source',
            nested: {
              step: 'dispatch',
            },
          },
          requestId: 'req-source',
          jobId: 'job-1',
          tabId: 7,
        },
      ],
      totalMatched: 1,
      returned: 1,
      hasMore: false,
      totalStored: 12,
    }))

    const args = tool.parseArgs({
      levels: ['error'],
      scope: 'mcp-bridge',
      jobId: 'job-1',
      tabId: 7,
      limit: 50,
    })
    const result = await tool.execute(args, {
      requestId: 'req-debug-get',
      selectedTabId: null,
      sendCommand,
    })

    expect(sendCommand).toHaveBeenCalledWith(
      'debug.get_logs',
      {
        levels: ['error'],
        scope: 'mcp-bridge',
        jobId: 'job-1',
        tabId: 7,
        limit: 50,
      },
      {
        requestId: 'req-debug-get',
        jobId: 'job-1',
        timeoutMs: 10 * 60_000,
      }
    )
    expect(result).toEqual({
      kind: 'text',
      text: expect.stringContaining('[2026-03-22T10:00:00.000Z] ERROR background mcp-bridge'),
    })
    expect((result as { text: string }).text).toContain('returned: 1')
    expect((result as { text: string }).text).toContain('jobId: job-1')
    expect((result as { text: string }).text).toContain('nested:')
    expect((result as { text: string }).text).toContain('step: dispatch')
  })

  it('executes debug_export_logs_to_file and writes queried logs to a log file', async () => {
    const registry = new ToolRegistry()
    const tool = registry.get('debug_export_logs_to_file')
    expect(tool).not.toBeNull()
    if (!tool || !tool.execute) {
      throw new Error('debug_export_logs_to_file tool is not available')
    }

    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'datalens-debug-log-'))
    createdDirs.push(outputDir)
    const sendCommand = vi.fn(async () => ({
      items: [
        {
          id: 'log-1',
          timestamp: '2026-03-22T10:00:00.000Z',
          level: 'error',
          source: 'background',
          scope: 'mcp-bridge',
          message: 'Bridge command failed',
          context: {
            requestId: 'req-source',
            jobId: 'job-1',
          },
          requestId: 'req-source',
          jobId: 'job-1',
        },
      ],
      totalMatched: 1,
      returned: 1,
      hasMore: false,
      totalStored: 12,
    }))

    const args = tool.parseArgs({
      levels: ['error'],
      scope: 'mcp-bridge',
      outputDir,
    })
    const result = await tool.execute(args, {
      requestId: 'req-debug-export',
      selectedTabId: null,
      sendCommand,
    })

    expect(sendCommand).toHaveBeenCalledWith(
      'debug.get_logs',
      {
        levels: ['error'],
        scope: 'mcp-bridge',
        limit: 5000,
      },
      {
        requestId: 'req-debug-export',
        timeoutMs: 10 * 60_000,
      }
    )
    expect(result).toMatchObject({
      kind: 'text',
      text: expect.stringContaining(`outputDir: ${outputDir}`),
    })
    expect((result as { text: string }).text).toContain('format: log')
    expect((result as { text: string }).text).toContain('returned: 1')
    expect((result as { text: string }).text).toContain('totalMatched: 1')
    expect((result as { text: string }).text).toContain('.log')

    const files = await fs.readdir(outputDir)
    expect(files).toHaveLength(1)
    const fileContent = await fs.readFile(path.join(outputDir, files[0]!), 'utf8')
    expect(fileContent).toContain('exportedAt:')
    expect(fileContent).toContain('format: log')
    expect(fileContent).toContain('totalMatched: 1')
    expect(fileContent).toContain('[2026-03-22T10:00:00.000Z] ERROR background mcp-bridge')
    expect(fileContent).toContain('message: Bridge command failed')
  })

  it('executes scrape_export_to_file and writes decoded artifact content', async () => {
    const registry = new ToolRegistry()
    const tool = registry.get('scrape_export_to_file')
    expect(tool).not.toBeNull()
    if (!tool || !tool.execute) {
      throw new Error('scrape_export_to_file tool is not available')
    }

    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'datalens-tool-'))
    createdDirs.push(outputDir)
    const sendCommand = vi.fn(async () => ({
      artifact: {
        artifactId: 'artifact-1',
        fileName: 'rows.json',
        mimeType: 'application/json',
        contentBase64: Buffer.from(JSON.stringify([{ id: 1 }])).toString('base64'),
      },
    }))

    const args = tool.parseArgs({
      jobId: 'job-1',
      outputDir,
      format: 'json',
    })
    const result = await tool.execute(args, {
      requestId: 'req-2',
      selectedTabId: null,
      sendCommand,
    })

    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      status: 'ok',
      requestId: 'req-2',
      jobId: 'job-1',
      format: 'json',
      outputDir,
      fileName: 'rows.json',
      mimeType: 'application/json',
      artifactId: 'artifact-1',
    })

    const content = await fs.readFile((result as { filePath: string }).filePath, 'utf8')
    expect(content).toContain('"id":1')
  })

  it('executes scrape_status after optional waitMs', async () => {
    vi.useFakeTimers()

    try {
      const registry = new ToolRegistry()
      const tool = registry.get('scrape_status')
      expect(tool).not.toBeNull()
      if (!tool || !tool.execute) {
        throw new Error('scrape_status tool is not executable')
      }

      const sendCommand = vi.fn(async () => ({
        jobId: 'job-1',
        status: 'running',
      }))

      const args = tool.parseArgs({
        jobId: 'job-1',
        waitMs: 250,
      })
      const resultPromise = tool.execute(args, {
        requestId: 'req-3',
        selectedTabId: null,
        sendCommand,
      })

      expect(sendCommand).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(249)
      expect(sendCommand).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)

      const result = await resultPromise

      expect(sendCommand).toHaveBeenCalledTimes(1)
      expect(sendCommand).toHaveBeenCalledWith(
        'scrape.status',
        { jobId: 'job-1' },
        { requestId: 'req-3', jobId: 'job-1' }
      )
      expect(result).toEqual({
        jobId: 'job-1',
        status: 'running',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('builds debug_clear_logs command with optional filters', () => {
    const registry = new ToolRegistry()
    const tool = registry.get('debug_clear_logs')
    expect(tool).not.toBeNull()
    if (!tool || !tool.buildCommand) {
      throw new Error('debug_clear_logs tool is not available')
    }

    const args = tool.parseArgs({
      sources: ['sidepanel'],
      searchText: 'auth',
    })

    expect(
      tool.buildCommand(args, {
        requestId: 'req-clear',
        selectedTabId: null,
        sendCommand: vi.fn(),
      })
    ).toEqual({
      commandName: 'debug.clear_logs',
      payload: {
        sources: ['sidepanel'],
        searchText: 'auth',
      },
      requestId: 'req-clear',
    })
  })

  it('builds scrape_detect_tables with explicit tab open mode', () => {
    const registry = new ToolRegistry()
    const tool = registry.get('scrape_detect_tables')
    expect(tool).not.toBeNull()
    if (!tool || !tool.buildCommand) {
      throw new Error('scrape_detect_tables tool is not available')
    }

    const args = tool.parseArgs({
      url: 'https://example.com/list',
      prompt: 'Extract the main list.',
      tabOpenMode: 'create_new',
    })

    expect(
      tool.buildCommand(args, {
        requestId: 'req-detect',
        selectedTabId: null,
        sendCommand: vi.fn(),
      })
    ).toEqual({
      commandName: 'scrape.detect_tables',
      payload: {
        requestId: 'req-detect',
        url: 'https://example.com/list',
        prompt: 'Extract the main list.',
        tabOpenMode: 'create_new',
      },
      requestId: 'req-detect',
    })
  })

  it('builds browser_open_tab with explicit open mode', () => {
    const registry = new ToolRegistry()
    const tool = registry.get('browser_open_tab')
    expect(tool).not.toBeNull()
    if (!tool || !tool.buildCommand) {
      throw new Error('browser_open_tab tool is not available')
    }

    const args = tool.parseArgs({
      url: 'https://example.com/list',
      openMode: 'create_new',
    })

    expect(
      tool.buildCommand(args, {
        requestId: 'req-open',
        selectedTabId: null,
        sendCommand: vi.fn(),
      })
    ).toEqual({
      commandName: 'browser.open_tab',
      payload: {
        url: 'https://example.com/list',
        openMode: 'create_new',
      },
      requestId: 'req-open',
    })
  })

  it('does not expose scrape_prepare_job', () => {
    const registry = new ToolRegistry()
    expect(registry.get('scrape_prepare_job')).toBeNull()
  })
})
