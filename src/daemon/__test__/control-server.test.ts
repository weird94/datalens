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

    const result = await client.invokeTool('session-a', 'scrape_start', {
      scraperConfig: {},
    })

    expect(invokeTool).toHaveBeenCalledWith('scrape_start', {
      scraperConfig: {},
    }, 'session-a')
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
})
