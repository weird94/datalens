#!/usr/bin/env node

import { nanoid } from 'nanoid'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ToolRegistry } from './core/tool-registry'
import { getDaemonControlHost, getDaemonControlPort } from './daemon/config'
import { ControlClient } from './daemon/control-client'
import { logger } from './obs/logger-metrics-trace'
import { installRuntimeTerminationHandlers, type RuntimeShutdownReason } from './process-lifecycle'
import { DaemonLauncher } from './proxy/daemon-launcher'
import { ProxyMcpHandler } from './proxy/proxy-mcp-handler'
import { StdioAdapter } from './transport/stdio-adapter'

interface ProxyRuntime {
  sessionId: string
  stdioAdapter: StdioAdapter
  controlClient: ControlClient
}

function isCompiledMode(): boolean {
  const currentFilePath = fileURLToPath(import.meta.url)
  return currentFilePath.endsWith('.js')
}

function getRepoRoot(): string {
  const currentFilePath = fileURLToPath(import.meta.url)
  return path.resolve(path.dirname(currentFilePath), '../../..')
}

function getDaemonCliPath(): string {
  const currentFilePath = fileURLToPath(import.meta.url)
  const dir = path.dirname(currentFilePath)
  return isCompiledMode()
    ? path.resolve(dir, './daemon-cli.js')
    : path.resolve(dir, './daemon-cli.ts')
}

function getPnpmCommand(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function spawnDaemonProcess(): { unref: () => void } {
  const daemonPath = getDaemonCliPath()
  const [cmd, args] = isCompiledMode()
    ? ['node', [daemonPath]]
    : [getPnpmCommand(), ['--dir', getRepoRoot(), 'exec', 'tsx', daemonPath]]

  const child = spawn(cmd, args, {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  })

  return child
}

async function bootstrapProxyRuntime(): Promise<ProxyRuntime> {
  const controlClient = new ControlClient({
    host: getDaemonControlHost(),
    port: getDaemonControlPort(),
  })
  const launcher = new DaemonLauncher(controlClient, spawnDaemonProcess)
  await launcher.ensureStarted()

  const sessionId = nanoid()
  const proxyHandler = new ProxyMcpHandler(new ToolRegistry(), controlClient, sessionId)
  const stdioAdapter = new StdioAdapter(proxyHandler.createServer())
  await stdioAdapter.start()

  logger.info('DataLens MCP proxy started', {
    stateAfter: 'stdio-proxy',
  })

  return {
    sessionId,
    stdioAdapter,
    controlClient,
  }
}

async function shutdownProxyRuntime(
  runtime: ProxyRuntime,
  reason: RuntimeShutdownReason
): Promise<void> {
  logger.info('Shutting down MCP proxy', {
    stateAfter: reason,
  })

  try {
    await runtime.controlClient.closeSession(runtime.sessionId)
  } catch {
    // Best-effort cleanup when the daemon is already gone.
  }

  await runtime.stdioAdapter.stop()
}

async function main(): Promise<void> {
  const runtime = await bootstrapProxyRuntime()

  installRuntimeTerminationHandlers(
    {
      processEvents: process,
      stdin: process.stdin,
      scheduler: {
        setTimeout: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
      },
    },
    async reason => {
      await shutdownProxyRuntime(runtime, reason)
    }
  )
}

void main().catch(error => {
  logger.error('MCP proxy bootstrap failed', {
    errorCode: error instanceof Error ? error.message : String(error),
  })
  process.exit(1)
})
