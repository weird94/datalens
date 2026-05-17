import { describe, expect, it, vi } from 'vitest'
import { ToolRegistry } from '../tool-registry'

const CHAT_TOOL_NAMES = [
  'openAiWorkspaceTab',
  'readPageA11yTree',
  'readPageRefPug',
  'operatePage',
  'detectScrapeTargets',
  'analyzeScrapeConfig',
  'applyDrillDownScrape',
  'startScrape',
  'listWorkspaceAssets',
  'inspectWorkspaceAsset',
  'runDataCode',
]

const DEBUG_TOOL_NAMES = [
  'debugStartRun',
  'debugGetLogs',
  'debugClearLogs',
  'debugGetRunDiagnostics',
]

describe('ToolRegistry', () => {
  it('exposes chat page tools plus AI diagnostics tools', () => {
    const registry = new ToolRegistry()

    expect(registry.list().map(tool => tool.name)).toEqual([
      ...CHAT_TOOL_NAMES,
      ...DEBUG_TOOL_NAMES,
    ])
  })

  it('does not expose legacy browser or scrape tools', () => {
    const registry = new ToolRegistry()

    expect(registry.get('browser_open_tab')).toBeNull()
    expect(registry.get('scrape_detect_tables')).toBeNull()
    expect(registry.get('debug_get_logs')).toBeNull()
    expect(registry.get('debugGetLogs')).not.toBeNull()
  })

  it('maps openAiWorkspaceTab to the chat bridge command with requestId in payload', () => {
    const registry = new ToolRegistry()
    const tool = registry.get('openAiWorkspaceTab')
    expect(tool).not.toBeNull()
    if (!tool || !tool.buildCommand) {
      throw new Error('openAiWorkspaceTab tool is not available')
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
      commandName: 'ai_tool.open_workspace_tab',
      payload: {
        requestId: 'req-open',
        url: 'https://example.com/list',
        openMode: 'create_new',
      },
      requestId: 'req-open',
      timeoutMs: 30_000,
    })
  })

  it('maps readPageRefPug to the chat bridge command', () => {
    const registry = new ToolRegistry()
    const tool = registry.get('readPageRefPug')
    expect(tool).not.toBeNull()
    if (!tool || !tool.buildCommand) {
      throw new Error('readPageRefPug tool is not available')
    }

    const args = tool.parseArgs({
      tabId: 7,
      snapshotId: 'snapshot-1',
      ref: 'page_e12',
      context: 'parent',
      traceId: 'trace-1',
    })

    expect(
      tool.buildCommand(args, {
        requestId: 'req-pug',
        selectedTabId: null,
        sendCommand: vi.fn(),
      })
    ).toEqual({
      commandName: 'ai_tool.read_page_ref_pug',
      payload: {
        requestId: 'req-pug',
        traceId: 'trace-1',
        tabId: 7,
        snapshotId: 'snapshot-1',
        ref: 'page_e12',
        context: 'parent',
      },
      requestId: 'req-pug',
      timeoutMs: 30_000,
    })
  })

  it('passes traceId through chat scraping tools for diagnostics correlation', () => {
    const registry = new ToolRegistry()
    const tool = registry.get('detectScrapeTargets')
    expect(tool).not.toBeNull()
    if (!tool || !tool.buildCommand) {
      throw new Error('detectScrapeTargets tool is not available')
    }

    const args = tool.parseArgs({
      tabId: 7,
      prompt: 'Find product cards',
      traceId: 'trace-1',
    })

    expect(
      tool.buildCommand(args, {
        requestId: 'req-detect',
        selectedTabId: null,
        sendCommand: vi.fn(),
      }).payload
    ).toEqual({
      requestId: 'req-detect',
      traceId: 'trace-1',
      tabId: 7,
      prompt: 'Find product cards',
    })
  })

  it('maps debug diagnostics tools to bridge commands', () => {
    const registry = new ToolRegistry()
    const tool = registry.get('debugGetRunDiagnostics')
    expect(tool).not.toBeNull()
    if (!tool || !tool.buildCommand) {
      throw new Error('debugGetRunDiagnostics tool is not available')
    }

    const args = tool.parseArgs({
      traceId: 'trace-1',
      limit: 50,
    })

    expect(
      tool.buildCommand(args, {
        requestId: 'req-debug',
        selectedTabId: null,
        sendCommand: vi.fn(),
      })
    ).toEqual({
      commandName: 'debug.get_run_diagnostics',
      payload: {
        traceId: 'trace-1',
        limit: 50,
      },
      requestId: 'req-debug',
    })
  })

  it('normalizes bare openAiWorkspaceTab URLs like the chat tool', () => {
    const registry = new ToolRegistry()
    const tool = registry.get('openAiWorkspaceTab')
    expect(tool).not.toBeNull()
    if (!tool || !tool.buildCommand) {
      throw new Error('openAiWorkspaceTab tool is not available')
    }

    const args = tool.parseArgs({
      url: 'example.com/list',
    })

    expect(
      tool.buildCommand(args, {
        requestId: 'req-open',
        selectedTabId: null,
        sendCommand: vi.fn(),
      }).payload.url
    ).toBe('https://example.com/list')
  })

  it('maps detectScrapeTargets to the chat bridge command with tabId and prompt', () => {
    const registry = new ToolRegistry()
    const tool = registry.get('detectScrapeTargets')
    expect(tool).not.toBeNull()
    if (!tool || !tool.buildCommand) {
      throw new Error('detectScrapeTargets tool is not available')
    }

    const args = tool.parseArgs({
      tabId: 7,
      prompt: 'Find product cards',
    })

    expect(
      tool.buildCommand(args, {
        requestId: 'req-detect',
        selectedTabId: null,
        sendCommand: vi.fn(),
      })
    ).toEqual({
      commandName: 'ai_tool.detect_scrape_targets',
      payload: {
        requestId: 'req-detect',
        tabId: 7,
        prompt: 'Find product cards',
      },
      requestId: 'req-detect',
      timeoutMs: 120_000,
    })
  })

  it('maps analyzeScrapeConfig to the chat bridge command with selectors', () => {
    const registry = new ToolRegistry()
    const tool = registry.get('analyzeScrapeConfig')
    expect(tool).not.toBeNull()
    if (!tool || !tool.buildCommand) {
      throw new Error('analyzeScrapeConfig tool is not available')
    }

    const args = tool.parseArgs({
      tabId: 7,
      rootSelector: '.list',
      itemSelector: '.row',
      documentInfoPath: 'body',
      previewLimit: 5,
    })

    expect(
      tool.buildCommand(args, {
        requestId: 'req-analyze',
        selectedTabId: null,
        sendCommand: vi.fn(),
      })
    ).toEqual({
      commandName: 'ai_tool.analyze_scrape_config',
      payload: {
        requestId: 'req-analyze',
        tabId: 7,
        rootSelector: '.list',
        itemSelector: '.row',
        documentInfoPath: 'body',
        previewLimit: 5,
      },
      requestId: 'req-analyze',
      timeoutMs: 120_000,
    })
  })

  it('maps runDataCode to the data workbench bridge command with the chat max timeout', () => {
    const registry = new ToolRegistry()
    const tool = registry.get('runDataCode')
    expect(tool).not.toBeNull()
    if (!tool || !tool.buildCommand) {
      throw new Error('runDataCode tool is not available')
    }

    const args = tool.parseArgs({
      code: 'print("ok")',
      fileNames: ['rows.csv'],
      language: 'python',
      timeoutMs: 120_000,
    })

    expect(
      tool.buildCommand(args, {
        requestId: 'req-code',
        selectedTabId: null,
        sendCommand: vi.fn(),
      })
    ).toEqual({
      commandName: 'data_workbench.run_data_code',
      payload: {
        code: 'print("ok")',
        fileNames: ['rows.csv'],
        language: 'python',
        timeoutMs: 120_000,
      },
      requestId: 'req-code',
      timeoutMs: 120_000,
    })
  })
})
