import { describe, expect, it, vi } from 'vitest'
import { ProxyMcpHandler } from '../proxy-mcp-handler'
import { ToolRegistry } from '../../core/tool-registry'

describe('ProxyMcpHandler', () => {
  it('forwards tool calls to the daemon with the proxy session id', async () => {
    const invokeTool = vi.fn(async () => ({
      status: 'ok',
      tabs: [],
    }))

    const handler = new ProxyMcpHandler(
      new ToolRegistry(),
      {
        invokeTool,
      },
      'session-a'
    )

    const result = await handler.invoke('listWorkspaceAssets', {})

    expect(invokeTool).toHaveBeenCalledWith('session-a', 'listWorkspaceAssets', {}, {})
    expect(result).toEqual({
      status: 'ok',
      tabs: [],
    })
  })
})
