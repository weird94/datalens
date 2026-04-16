import { McpHandler } from './core/mcp-handler'
import { logger } from './obs/logger-metrics-trace'
import { installRuntimeTerminationHandlers, type RuntimeShutdownReason } from './process-lifecycle'
import { bootstrapSharedRuntime, shutdownSharedRuntime, type SharedRuntime } from './runtime/shared-runtime'
import { StdioAdapter } from './transport/stdio-adapter'

interface Runtime extends SharedRuntime {
  stdioAdapter: StdioAdapter
}

export interface BootstrapRuntime extends Runtime {
  shutdown: () => Promise<void>
}

export function getSupportedTransportMode(): 'stdio' {
  return 'stdio'
}

async function bootstrap(): Promise<Runtime> {
  const sharedRuntime = await bootstrapSharedRuntime()
  const mcpHandler = new McpHandler(sharedRuntime.toolExecutor)

  const stdioAdapter = new StdioAdapter(mcpHandler.createServer())
  await stdioAdapter.start()

  logger.info('DataLens MCP server started', {
    stateAfter: getSupportedTransportMode(),
  })

  return {
    ...sharedRuntime,
    stdioAdapter,
  }
}

async function shutdownRuntime(runtime: Runtime): Promise<void> {
  await runtime.stdioAdapter.stop()
  await shutdownSharedRuntime(runtime)
}

export async function bootstrapForTest(): Promise<BootstrapRuntime> {
  const runtime = await bootstrap()

  return {
    ...runtime,
    shutdown: async () => {
      await shutdownRuntime(runtime)
    },
  }
}

async function main(): Promise<void> {
  const runtime = await bootstrap()

  const shutdown = async (reason: RuntimeShutdownReason) => {
    logger.info('Shutting down MCP server', {
      stateAfter: reason,
    })

    try {
      await shutdownRuntime(runtime)
    } catch (error) {
      logger.error('MCP server shutdown failed', {
        errorCode: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  installRuntimeTerminationHandlers(
    {
      processEvents: process,
      stdin: process.stdin,
      scheduler: {
        setTimeout: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
      },
    },
    shutdown
  )
}

void main().catch(error => {
  logger.error('MCP server bootstrap failed', {
    errorCode: error instanceof Error ? error.message : String(error),
  })
  process.exit(1)
})
