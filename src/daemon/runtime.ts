import { getDaemonControlHost, getDaemonControlPort } from './config'
import { ControlServer } from './control-server'
import { shutdownSharedRuntime, type SharedRuntime, bootstrapSharedRuntime } from '../runtime/shared-runtime'

export interface DaemonRuntime extends SharedRuntime {
  controlServer: ControlServer
  shutdown: () => Promise<void>
}

export async function bootstrapDaemonRuntime(): Promise<DaemonRuntime> {
  const sharedRuntime = await bootstrapSharedRuntime()
  const controlServer = new ControlServer(
    {
      host: getDaemonControlHost(),
      port: getDaemonControlPort(),
    },
    {
      invokeTool: async (toolName, args, sessionId) =>
        await sharedRuntime.toolExecutor.invoke(toolName, args, sessionId),
      closeSession: sessionId => {
        sharedRuntime.toolExecutor.clearSession(sessionId)
      },
    }
  )

  try {
    await controlServer.start()
  } catch (error) {
    await shutdownSharedRuntime(sharedRuntime)
    throw error
  }

  return {
    ...sharedRuntime,
    controlServer,
    shutdown: async () => {
      await controlServer.stop()
      await shutdownSharedRuntime(sharedRuntime)
    },
  }
}
