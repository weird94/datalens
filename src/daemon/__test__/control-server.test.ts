import { createServer } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ControlClient } from '../control-client'
import { ControlServer } from '../control-server'

interface TestAddressInfo {
  port: number
}

async function getAvailablePort(): Promise<number> {
  const server = createServer()

  return await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Expected numeric address info'))
        return
      }

      const port = (address as TestAddressInfo).port
      server.close(error => {
        if (error) {
          reject(error)
          return
        }

        resolve(port)
      })
    })
  })
}

describe('ControlServer', () => {
  const serversToStop: ControlServer[] = []

  afterEach(async () => {
    await Promise.all(serversToStop.splice(0).map(server => server.stop()))
    vi.restoreAllMocks()
  })

  it('responds to health checks', async () => {
    const port = await getAvailablePort()
    const server = new ControlServer(
      {
        host: '127.0.0.1',
        port,
      },
      {
        invokeTool: async () => ({ ok: true }),
        closeSession: () => {},
      }
    )
    serversToStop.push(server)
    await server.start()

    const client = new ControlClient({
      host: '127.0.0.1',
      port,
    })

    await expect(client.health()).resolves.toEqual({
      status: 'ok',
    })
  })

  it('forwards invokeTool requests with session isolation context', async () => {
    const port = await getAvailablePort()
    const invokeTool = vi.fn(async () => ({
      status: 'ok',
      jobId: 'job-1',
    }))
    const server = new ControlServer(
      {
        host: '127.0.0.1',
        port,
      },
      {
        invokeTool,
        closeSession: () => {},
      }
    )
    serversToStop.push(server)
    await server.start()

    const client = new ControlClient({
      host: '127.0.0.1',
      port,
    })

    const result = await client.invokeTool('session-a', 'startScrape', {
      scraperConfig: {},
    })

    expect(invokeTool).toHaveBeenCalledWith(
      'startScrape',
      {
        scraperConfig: {},
      },
      'session-a',
      expect.any(AbortSignal)
    )
    expect(result).toEqual({
      status: 'ok',
      jobId: 'job-1',
    })
  })

  it('calls closeSession when the proxy requests cleanup', async () => {
    const port = await getAvailablePort()
    const closeSession = vi.fn()
    const server = new ControlServer(
      {
        host: '127.0.0.1',
        port,
      },
      {
        invokeTool: async () => ({ ok: true }),
        closeSession,
      }
    )
    serversToStop.push(server)
    await server.start()

    const client = new ControlClient({
      host: '127.0.0.1',
      port,
    })

    await client.closeSession('session-a')

    expect(closeSession).toHaveBeenCalledWith('session-a')
  })

  it('aborts an active invocation when the proxy cancels the session', async () => {
    const port = await getAvailablePort()
    let activeSignal: AbortSignal | null = null
    let releaseInvoke: (() => void) | null = null
    const invokeTool = vi.fn(
      async (_toolName: string, _args: object, _sessionId: string, abortSignal?: AbortSignal) => {
        activeSignal = abortSignal ?? null
        await new Promise<void>(resolve => {
          releaseInvoke = resolve
        })
        return { ok: true }
      }
    )
    const server = new ControlServer(
      {
        host: '127.0.0.1',
        port,
      },
      {
        invokeTool,
        closeSession: () => {},
      }
    )
    serversToStop.push(server)
    await server.start()

    const client = new ControlClient({
      host: '127.0.0.1',
      port,
    })
    const invokePromise = client.invokeTool('session-a', 'startScrape', {}, {
      invocationId: 'invoke-a',
    })

    while (!activeSignal) {
      await new Promise(resolve => {
        setTimeout(resolve, 0)
      })
    }

    await client.cancelSession('session-a', { invocationId: 'invoke-a' })
    const signal = activeSignal as AbortSignal | null
    if (!signal) {
      throw new Error('Expected active abort signal')
    }
    expect(signal.aborted).toBe(true)

    const release = releaseInvoke as (() => void) | null
    if (!release) {
      throw new Error('Expected active invoke release callback')
    }
    release()
    await expect(invokePromise).resolves.toEqual({ ok: true })
  })

  it('cancels only the matching active invocation in a session', async () => {
    const port = await getAvailablePort()
    const activeSignals = new Map<string, AbortSignal>()
    const releaseCallbacks = new Map<string, () => void>()
    const invokeTool = vi.fn(
      async (_toolName: string, args: { label?: string }, _sessionId: string, abortSignal?: AbortSignal) => {
        const label = args.label
        if (!label || !abortSignal) {
          throw new Error('Expected labeled invocation')
        }
        activeSignals.set(label, abortSignal)
        await new Promise<void>(resolve => {
          releaseCallbacks.set(label, resolve)
        })
        return { ok: true, label }
      }
    )
    const server = new ControlServer(
      {
        host: '127.0.0.1',
        port,
      },
      {
        invokeTool: invokeTool as never,
        closeSession: () => {},
      }
    )
    serversToStop.push(server)
    await server.start()

    const client = new ControlClient({
      host: '127.0.0.1',
      port,
    })
    const firstInvoke = client.invokeTool(
      'session-a',
      'startScrape',
      { label: 'first' },
      { invocationId: 'invoke-first' }
    )
    const secondInvoke = client.invokeTool(
      'session-a',
      'startScrape',
      { label: 'second' },
      { invocationId: 'invoke-second' }
    )

    while (!activeSignals.has('first') || !activeSignals.has('second')) {
      await new Promise(resolve => {
        setTimeout(resolve, 0)
      })
    }

    await client.cancelSession('session-a', { invocationId: 'invoke-first' })
    expect(activeSignals.get('first')?.aborted).toBe(true)
    expect(activeSignals.get('second')?.aborted).toBe(false)

    releaseCallbacks.get('first')?.()
    releaseCallbacks.get('second')?.()
    await expect(firstInvoke).resolves.toEqual({ ok: true, label: 'first' })
    await expect(secondInvoke).resolves.toEqual({ ok: true, label: 'second' })
  })
})
