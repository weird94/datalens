import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  installRuntimeTerminationHandlers,
  PROCESS_SIGNAL_SIGINT,
  PROCESS_SIGNAL_SIGTERM,
  RUNTIME_SHUTDOWN_REASON_SIGTERM,
  RUNTIME_SHUTDOWN_REASON_STDIN_CLOSE,
  RUNTIME_SHUTDOWN_REASON_SIGINT,
  STDIN_EVENT_CLOSE,
  WATCHDOG_FAILURE_EXIT_CODE,
  WATCHDOG_FORCE_EXIT_TIMEOUT_MS,
  WATCHDOG_SUCCESS_EXIT_CODE,
} from '../process-lifecycle'
import type {
  ProcessLifecycleEvent,
  ProcessLifecycleStdinEvent,
  RuntimeShutdownReason,
  RuntimeTimerHandle,
} from '../process-lifecycle'

class FakeProcessEvents {
  private readonly emitter = new EventEmitter()
  readonly exit = vi.fn((code: number) => {
    void code
  })

  on(event: ProcessLifecycleEvent, listener: () => void): void {
    this.emitter.on(event, listener)
  }

  emit(event: ProcessLifecycleEvent): void {
    this.emitter.emit(event)
  }
}

class FakeStdinEvents {
  private readonly emitter = new EventEmitter()

  on(event: ProcessLifecycleStdinEvent, listener: () => void): void {
    this.emitter.on(event, listener)
  }

  emit(event: ProcessLifecycleStdinEvent): void {
    this.emitter.emit(event)
  }
}

class FakeScheduler {
  timeoutMs: number | null = null
  readonly unref = vi.fn(() => {})

  setTimeout(_handler: () => void, timeoutMs: number): RuntimeTimerHandle {
    this.timeoutMs = timeoutMs
    return {
      unref: this.unref,
    }
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('installRuntimeTerminationHandlers', () => {
  it('shuts down when stdin closes', async () => {
    const processEvents = new FakeProcessEvents()
    const stdin = new FakeStdinEvents()
    const scheduler = new FakeScheduler()
    const shutdown = vi.fn(async (_reason: RuntimeShutdownReason) => {})

    installRuntimeTerminationHandlers({ processEvents, stdin, scheduler }, shutdown)
    stdin.emit(STDIN_EVENT_CLOSE)
    await flushMicrotasks()

    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(shutdown).toHaveBeenCalledWith(RUNTIME_SHUTDOWN_REASON_STDIN_CLOSE)
    expect(scheduler.timeoutMs).toBe(WATCHDOG_FORCE_EXIT_TIMEOUT_MS)
    expect(scheduler.unref).toHaveBeenCalledTimes(1)
    expect(processEvents.exit).toHaveBeenCalledWith(WATCHDOG_SUCCESS_EXIT_CODE)
  })

  it('shuts down when SIGINT is received', async () => {
    const processEvents = new FakeProcessEvents()
    const stdin = new FakeStdinEvents()
    const scheduler = new FakeScheduler()
    const shutdown = vi.fn(async (_reason: RuntimeShutdownReason) => {})

    installRuntimeTerminationHandlers({ processEvents, stdin, scheduler }, shutdown)
    processEvents.emit(PROCESS_SIGNAL_SIGINT)
    await flushMicrotasks()

    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(shutdown).toHaveBeenCalledWith(RUNTIME_SHUTDOWN_REASON_SIGINT)
    expect(processEvents.exit).toHaveBeenCalledWith(WATCHDOG_SUCCESS_EXIT_CODE)
  })

  it('schedules shutdown only once when multiple lifecycle events fire', async () => {
    const processEvents = new FakeProcessEvents()
    const stdin = new FakeStdinEvents()
    const scheduler = new FakeScheduler()
    const shutdownReasons: RuntimeShutdownReason[] = []
    const pendingShutdown = {
      resolve: null as (() => void) | null,
    }

    installRuntimeTerminationHandlers({ processEvents, stdin, scheduler }, async reason => {
      shutdownReasons.push(reason)
      await new Promise<void>(resolve => {
        pendingShutdown.resolve = resolve
      })
    })

    processEvents.emit(PROCESS_SIGNAL_SIGTERM)
    stdin.emit(STDIN_EVENT_CLOSE)
    const currentResolveShutdown = pendingShutdown.resolve
    if (currentResolveShutdown) {
      currentResolveShutdown()
    }
    await flushMicrotasks()

    expect(shutdownReasons).toEqual([RUNTIME_SHUTDOWN_REASON_SIGTERM])
    expect(processEvents.exit).toHaveBeenCalledTimes(1)
    expect(processEvents.exit).toHaveBeenCalledWith(WATCHDOG_SUCCESS_EXIT_CODE)
  })

  it('exits with a failure code when shutdown throws', async () => {
    const processEvents = new FakeProcessEvents()
    const stdin = new FakeStdinEvents()
    const scheduler = new FakeScheduler()

    installRuntimeTerminationHandlers({ processEvents, stdin, scheduler }, async () => {
      throw new Error('shutdown failed')
    })

    processEvents.emit(PROCESS_SIGNAL_SIGTERM)
    await flushMicrotasks()

    expect(processEvents.exit).toHaveBeenCalledWith(WATCHDOG_FAILURE_EXIT_CODE)
  })
})
