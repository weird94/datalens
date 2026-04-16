import { CommandRouter } from '../bridge/command-router'
import { ExtensionConnectionManager } from '../bridge/extension-connection-manager'
import { JobOwnershipStore } from '../core/job-ownership-store'
import { SessionManager } from '../core/session-manager'
import { TabLeaseManager } from '../core/tab-lease-manager'
import { ToolExecutor } from '../core/tool-executor'
import { ToolRegistry } from '../core/tool-registry'
import { JobStore } from '../job/job-store'
import { BridgeAuthService } from '../security/authn-authz'
import { WsBridgeServer } from '../transport/ws-bridge-server'

export interface SharedRuntime {
  wsBridgeServer: WsBridgeServer
  commandRouter: CommandRouter
  toolExecutor: ToolExecutor
}

function readEnvInt(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) {
    return fallback
  }

  const parsed = Number(rawValue)
  return Number.isFinite(parsed) ? parsed : fallback
}

export async function bootstrapSharedRuntime(): Promise<SharedRuntime> {
  const bridgeHost = process.env.MCP_BRIDGE_HOST || '127.0.0.1'
  const bridgePort = readEnvInt(process.env.MCP_BRIDGE_PORT, 17373)
  const bridgePath = process.env.MCP_BRIDGE_PATH || '/bridge'

  const connectionManager = new ExtensionConnectionManager()
  const jobStore = new JobStore()
  const commandRouter = new CommandRouter(connectionManager, jobStore)
  commandRouter.start()

  const wsBridgeServer = new WsBridgeServer(
    {
      host: bridgeHost,
      port: bridgePort,
      path: bridgePath,
    },
    new BridgeAuthService(),
    connectionManager
  )

  const toolExecutor = new ToolExecutor(
    new ToolRegistry(),
    (commandName, payload, options) => commandRouter.sendCommand(commandName, payload, options),
    new SessionManager(),
    new TabLeaseManager(),
    new JobOwnershipStore()
  )

  await wsBridgeServer.start()

  return {
    wsBridgeServer,
    commandRouter,
    toolExecutor,
  }
}

export async function shutdownSharedRuntime(runtime: SharedRuntime): Promise<void> {
  runtime.commandRouter.stop()
  runtime.wsBridgeServer.stop()
}
