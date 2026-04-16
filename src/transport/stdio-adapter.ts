import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { logger } from '../obs/logger-metrics-trace'

export class StdioAdapter {
  private transport: StdioServerTransport | null = null

  constructor(private readonly server: McpServer) {}

  async start(): Promise<void> {
    if (this.transport) {
      return
    }

    const transport = new StdioServerTransport()
    await this.server.connect(transport)
    this.transport = transport

    logger.info('MCP stdio adapter connected')
  }

  async stop(): Promise<void> {
    if (!this.transport) {
      return
    }

    await this.transport.close()
    this.transport = null
    await this.server.close()
  }
}
