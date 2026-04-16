import { afterEach, describe, expect, it, vi } from 'vitest'

function hasTransportModeHelper(
  value: object
): value is { getSupportedTransportMode: () => 'stdio' } {
  return 'getSupportedTransportMode' in value
}

function hasBootstrapForTest(
  value: object
): value is { bootstrapForTest: () => Promise<{ shutdown: () => Promise<void> }> } {
  return 'bootstrapForTest' in value
}

vi.mock('../bridge/command-router', () => ({
  CommandRouter: class {
    start(): void {}
    stop(): void {}
  },
}))

vi.mock('../bridge/extension-connection-manager', () => ({
  ExtensionConnectionManager: class {},
}))

vi.mock('../job/job-store', () => ({
  JobStore: class {},
}))

vi.mock('../core/mcp-handler', () => ({
  McpHandler: class {
    createServer(): { close: () => Promise<void> } {
      return {
        close: async () => {},
      }
    }
  },
}))

vi.mock('../core/session-manager', () => ({
  SessionManager: class {},
}))

vi.mock('../core/tool-registry', () => ({
  ToolRegistry: class {},
}))

vi.mock('../security/authn-authz', () => ({
  BridgeAuthService: class {},
}))

vi.mock('../transport/stdio-adapter', () => ({
  StdioAdapter: class {
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
  },
}))

vi.mock('../transport/ws-bridge-server', () => ({
  WsBridgeServer: class {
    start(): void {}
    stop(): void {}
  },
}))

describe('index module', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('exports a stdio-only transport helper', async () => {
    const module = await import('../index')

    expect(hasTransportModeHelper(module)).toBe(true)

    if (!hasTransportModeHelper(module)) {
      return
    }

    expect(module.getSupportedTransportMode()).toBe('stdio')
  })

  it('exports bootstrapForTest for protocol-safe startup verification', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const module = await import('../index')

    expect(hasBootstrapForTest(module)).toBe(true)

    if (!hasBootstrapForTest(module)) {
      return
    }

    const runtime = await module.bootstrapForTest()
    await runtime.shutdown()

    expect(stdoutSpy).not.toHaveBeenCalled()
  })
})
