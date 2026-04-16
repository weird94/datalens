export const DEFAULT_DAEMON_STARTUP_TIMEOUT_MS = 15_000
export const DEFAULT_DAEMON_POLL_INTERVAL_MS = 200
const UNAVAILABLE_ERROR_CODES = ['ECONNREFUSED', 'ECONNRESET', 'ENOENT'] as const

interface HealthClient {
  health: () => Promise<{ status: 'ok' }>
}

interface SpawnedDaemonProcess {
  unref: () => void
}

interface DaemonLauncherOptions {
  startupTimeoutMs?: number
  pollIntervalMs?: number
}

function isUnavailableError(error: Error): boolean {
  return (
    'code' in error &&
    typeof error.code === 'string' &&
    UNAVAILABLE_ERROR_CODES.includes(error.code as (typeof UNAVAILABLE_ERROR_CODES)[number])
  )
}

async function waitForMs(delayMs: number): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(resolve, delayMs)
  })
}

export class DaemonLauncher {
  private readonly startupTimeoutMs: number
  private readonly pollIntervalMs: number

  constructor(
    private readonly healthClient: HealthClient,
    private readonly spawnDaemon: () => SpawnedDaemonProcess,
    options?: DaemonLauncherOptions
  ) {
    this.startupTimeoutMs = options?.startupTimeoutMs ?? DEFAULT_DAEMON_STARTUP_TIMEOUT_MS
    this.pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_DAEMON_POLL_INTERVAL_MS
  }

  async ensureStarted(): Promise<void> {
    try {
      await this.healthClient.health()
      return
    } catch (error) {
      if (!(error instanceof Error) || !isUnavailableError(error)) {
        throw error
      }
    }

    const daemonProcess = this.spawnDaemon()
    daemonProcess.unref()

    const deadline = Date.now() + this.startupTimeoutMs
    while (Date.now() < deadline) {
      try {
        await this.healthClient.health()
        return
      } catch (error) {
        if (error instanceof Error && !isUnavailableError(error)) {
          throw error
        }
      }

      await waitForMs(this.pollIntervalMs)
    }

    throw new Error(`Daemon did not become healthy within ${String(this.startupTimeoutMs)}ms`)
  }
}
