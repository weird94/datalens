#!/usr/bin/env node

import { logger } from './obs/logger-metrics-trace'
import { bootstrapDaemonRuntime } from './daemon/runtime'

async function main(): Promise<void> {
  const runtime = await bootstrapDaemonRuntime()

  const shutdown = async (reason: string) => {
    logger.info('Shutting down MCP daemon', {
      stateAfter: reason,
    })

    try {
      await runtime.shutdown()
    } finally {
      process.exit(0)
    }
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
}

void main().catch(error => {
  logger.error('MCP daemon bootstrap failed', {
    errorCode: error instanceof Error ? error.message : String(error),
  })
  process.exit(1)
})
