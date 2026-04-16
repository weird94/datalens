export const PROCESS_SIGNAL_SIGINT = 'SIGINT'
export const PROCESS_SIGNAL_SIGTERM = 'SIGTERM'
export const PROCESS_SIGNAL_SIGHUP = 'SIGHUP'
export const PROCESS_DISCONNECT_EVENT = 'disconnect'

export const STDIN_EVENT_CLOSE = 'close'
export const STDIN_EVENT_END = 'end'

export const RUNTIME_SHUTDOWN_REASON_SIGINT = 'SIGINT'
export const RUNTIME_SHUTDOWN_REASON_SIGTERM = 'SIGTERM'
export const RUNTIME_SHUTDOWN_REASON_SIGHUP = 'SIGHUP'
export const RUNTIME_SHUTDOWN_REASON_DISCONNECT = 'disconnect'
export const RUNTIME_SHUTDOWN_REASON_STDIN_CLOSE = 'stdin.close'
export const RUNTIME_SHUTDOWN_REASON_STDIN_END = 'stdin.end'
export const WATCHDOG_FORCE_EXIT_TIMEOUT_MS = 15_000
export const WATCHDOG_SUCCESS_EXIT_CODE = 0
export const WATCHDOG_FAILURE_EXIT_CODE = 1

const PROCESS_EVENT_REASON_MAP = {
  [PROCESS_SIGNAL_SIGINT]: RUNTIME_SHUTDOWN_REASON_SIGINT,
  [PROCESS_SIGNAL_SIGTERM]: RUNTIME_SHUTDOWN_REASON_SIGTERM,
} as const

const STDIN_EVENT_REASON_MAP = {
  [STDIN_EVENT_CLOSE]: RUNTIME_SHUTDOWN_REASON_STDIN_CLOSE,
} as const

const PROCESS_LIFECYCLE_EVENTS = [
  PROCESS_SIGNAL_SIGINT,
  PROCESS_SIGNAL_SIGTERM,
] as const

const STDIN_LIFECYCLE_EVENTS = [STDIN_EVENT_CLOSE] as const

export type ProcessLifecycleEvent = (typeof PROCESS_LIFECYCLE_EVENTS)[number]
export type ProcessLifecycleStdinEvent = (typeof STDIN_LIFECYCLE_EVENTS)[number]
export type RuntimeShutdownReason =
  | (typeof PROCESS_EVENT_REASON_MAP)[ProcessLifecycleEvent]
  | (typeof STDIN_EVENT_REASON_MAP)[ProcessLifecycleStdinEvent]

export interface RuntimeProcessEvents {
  on(event: ProcessLifecycleEvent, listener: () => void): void
  exit(code: number): void
}

export interface RuntimeStdinEvents {
  on(event: ProcessLifecycleStdinEvent, listener: () => void): void
}

export interface RuntimeTimerHandle {
  unref?: () => void
}

export interface RuntimeTimerScheduler {
  setTimeout(handler: () => void, timeoutMs: number): RuntimeTimerHandle
}

export interface RuntimeTerminationRegistration {
  processEvents: RuntimeProcessEvents
  stdin: RuntimeStdinEvents
  scheduler: RuntimeTimerScheduler
}

export type RuntimeShutdownHandler = (reason: RuntimeShutdownReason) => Promise<void> | void

export function installRuntimeTerminationHandlers(
  registration: RuntimeTerminationRegistration,
  shutdown: RuntimeShutdownHandler
): void {
  let shutdownScheduled = false

  const scheduleShutdown = (reason: RuntimeShutdownReason): void => {
    if (shutdownScheduled) {
      return
    }

    shutdownScheduled = true
    const forceExitTimer = registration.scheduler.setTimeout(() => {
      registration.processEvents.exit(WATCHDOG_SUCCESS_EXIT_CODE)
    }, WATCHDOG_FORCE_EXIT_TIMEOUT_MS)

    forceExitTimer.unref?.()

    void (async () => {
      try {
        await shutdown(reason)
        registration.processEvents.exit(WATCHDOG_SUCCESS_EXIT_CODE)
      } catch {
        registration.processEvents.exit(WATCHDOG_FAILURE_EXIT_CODE)
      }
    })()
  }

  PROCESS_LIFECYCLE_EVENTS.forEach(event => {
    registration.processEvents.on(event, () => {
      scheduleShutdown(PROCESS_EVENT_REASON_MAP[event])
    })
  })

  STDIN_LIFECYCLE_EVENTS.forEach(event => {
    registration.stdin.on(event, () => {
      scheduleShutdown(STDIN_EVENT_REASON_MAP[event])
    })
  })
}
